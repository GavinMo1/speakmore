package main

// 入口和线程：低级钩子的回调由装它的那个线程在取消息时调用，剪贴板也要一个窗口当主人，所以这些都放在
// 同一个锁定的系统线程上跑一个消息循环。读标准输入、写标准输出各是一个 goroutine：要在钩子线程上做的事
// 经 tasks 交过去、再投一条消息叫醒它；钩子回调里不做任何会等的事（系统嫌慢会悄悄卸掉钩子）。

import (
	"bufio"
	"fmt"
	"os"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

// 模拟粘贴之后等多久再还原剪贴板：太短的话目标应用还没来得及读（同 macOS 版）
const restoreDelay = 300 * time.Millisecond

// 一次录音最长 9 分钟。截了这么久父进程还没说"不截了"，多半是它那边出了岔子：自己松开，
// 不能让 esc 在所有应用里一直按不出来
const captureLimit = 600 * time.Second

const wmTask = wmApp + 1

var (
	out   = make(chan []byte, 256)
	tasks = make(chan func(), 64)

	state     keyState
	board     *clipboard
	window    uintptr
	mouseHook uintptr
	// 截的期限：每次开始截换一个号，过期的那个不算数
	captureGeneration int
)

func emit(e event) { out <- encodeEvent(e) }

// 交给钩子线程去做
func onUIThread(task func()) {
	tasks <- task
	procPostMessageW.Call(window, wmTask, 0, 0)
}

func keyboardProc(code int32, wParam, lParam uintptr) uintptr {
	if code >= 0 {
		info := (*kbdLLHookStruct)(unsafe.Pointer(lParam))
		down := wParam == wmKeyDown || wParam == wmSysKeyDown
		if down || wParam == wmKeyUp || wParam == wmSysKeyUp {
			result := state.onKey(keyInput{vk: info.vkCode, scan: info.scanCode, down: down, ours: info.extraInfo == ourMark})
			report(result)
			if result.swallow {
				return 1
			}
		}
	}
	next, _, _ := procCallNextHookEx.Call(0, uintptr(code), wParam, lParam)
	return next
}

func mouseProc(code int32, wParam, lParam uintptr) uintptr {
	if code >= 0 && (wParam == wmLButtonDown || wParam == wmLButtonUp) {
		info := (*msLLHookStruct)(unsafe.Pointer(lParam))
		if info.extraInfo != ourMark {
			result := state.onLeftButton(wParam == wmLButtonDown, float64(info.x), float64(info.y))
			report(result)
			if !state.wantsCapture() {
				// 不能在自己的回调里把自己卸掉：回到消息循环里再卸
				onUIThread(settleMouseHook)
			}
			if result.swallow {
				return 1
			}
		}
	}
	next, _, _ := procCallNextHookEx.Call(0, uintptr(code), wParam, lParam)
	return next
}

func report(result outcome) {
	for _, e := range result.events {
		emit(e)
	}
	if result.mask {
		onUIThread(func() { sendKeys([]uint16{vkMask, vkMask}, []bool{true, false}) })
	}
}

// 交给系统的回调。在 init 里建：鼠标的回调要装卸它自己，写成包级变量的初始值会成环
var keyboardCallback, mouseCallback, windowCallback uintptr

func init() {
	keyboardCallback = syscall.NewCallback(func(code, wParam, lParam uintptr) uintptr {
		return keyboardProc(int32(code), wParam, lParam)
	})
	mouseCallback = syscall.NewCallback(func(code, wParam, lParam uintptr) uintptr {
		return mouseProc(int32(code), wParam, lParam)
	})
	windowCallback = syscall.NewCallback(windowProc)
}

func installHook(kind int, callback uintptr) uintptr {
	module, _, _ := procGetModuleHandleW.Call(0)
	hook, _, _ := procSetWindowsHookExW.Call(uintptr(kind), callback, module, 0)
	return hook
}

// 鼠标钩子只在要截的时候装着：装着时全系统每一下鼠标都要先过我们这里
func settleMouseHook() {
	if state.wantsCapture() && mouseHook == 0 {
		mouseHook = installHook(whMouseLL, mouseCallback)
		if mouseHook == 0 {
			emit(event{"event": "error", "message": "装不上鼠标钩子，悬浮条上的按钮点不了"})
		}
	} else if !state.wantsCapture() && mouseHook != 0 {
		procUnhookWindowsHookEx.Call(mouseHook)
		mouseHook = 0
	}
}

func setCapturing(on bool, regions []region) {
	captureGeneration++
	state.setCapturing(on, regions)
	settleMouseHook()
	if !on {
		return
	}
	generation := captureGeneration
	time.AfterFunc(captureLimit, func() {
		onUIThread(func() {
			if generation != captureGeneration || !state.capturing {
				return
			}
			emit(event{"event": "error", "message": fmt.Sprintf("截了 %d 秒还没人说不截了，自己松开", int(captureLimit.Seconds()))})
			setCapturing(false, nil)
		})
	})
}

// 存剪贴板 → 写入文字 → 模拟 Ctrl+V → 等一会儿 → 还原剪贴板。只有粘贴这一条路，同 macOS 版
func paste(id int, text string) {
	if foregroundBlocksInput() {
		// 系统不让模拟的按键进管理员窗口，而且不报错。把文字留在剪贴板里，让用户自己按 Ctrl+V
		if err := board.writeText(text, false); err != nil {
			emit(event{"event": "error", "message": err.Error()})
		}
		emit(event{"event": "pasted", "id": id, "ok": false, "reason": "elevated"})
		return
	}
	saved, err := board.snapshot()
	if err != nil {
		emit(event{"event": "error", "message": "存不下剪贴板：" + err.Error()})
	}
	if err := board.writeText(text, true); err != nil {
		emit(event{"event": "error", "message": err.Error()})
		emit(event{"event": "pasted", "id": id, "ok": false, "reason": "clipboard"})
		return
	}
	if !sendKeys([]uint16{vkControl, vkV, vkV, vkControl}, []bool{true, true, false, false}) {
		// 文字已经在剪贴板里了：不还原，让用户自己按
		emit(event{"event": "pasted", "id": id, "ok": false, "reason": "send_input"})
		return
	}
	time.AfterFunc(restoreDelay, func() {
		onUIThread(func() {
			if saved != nil {
				if err := board.restore(saved); err != nil {
					emit(event{"event": "error", "message": "还原不了剪贴板：" + err.Error()})
				}
			}
			emit(event{"event": "pasted", "id": id, "ok": true})
		})
	})
}

func handle(line []byte) {
	cmd, err := parseCommand(line)
	if err != nil {
		emit(event{"event": "error", "message": err.Error()})
		return
	}
	switch cmd.Cmd {
	case "paste":
		if cmd.ID == nil || cmd.Text == nil {
			emit(event{"event": "error", "message": "paste 需要 id 和 text"})
			return
		}
		id, text := *cmd.ID, *cmd.Text
		onUIThread(func() { paste(id, text) })
	case "capture":
		regions, err := parseRegions(cmd.Regions)
		if err != nil {
			emit(event{"event": "error", "message": err.Error()})
			return
		}
		onUIThread(func() { setCapturing(true, regions) })
	case "release":
		onUIThread(func() { setCapturing(false, nil) })
	default:
		emit(event{"event": "error", "message": "不认识的命令：" + cmd.Cmd})
	}
}

func windowProc(hwnd, message, wParam, lParam uintptr) uintptr {
	if message == wmTask {
		for {
			select {
			case task := <-tasks:
				task()
			default:
				return 0
			}
		}
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, message, wParam, lParam)
	return result
}

func createMessageWindow() uintptr {
	module, _, _ := procGetModuleHandleW.Call(0)
	class := wndClassEx{wndProc: windowCallback, instance: module, className: utf16Ptr("SpeakMoreKeyHelper")}
	class.size = uint32(unsafe.Sizeof(class))
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&class)))
	hwnd, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(class.className)), 0, 0, 0, 0, 0, 0,
		hwndMessage, 0, module, 0)
	return hwnd
}

// 自检（不发按键）：剪贴板能写进去、带上了"临时"标记、还原之后和原来一模一样
func selfTest() bool {
	before, err := board.snapshot()
	if err != nil {
		emit(event{"event": "error", "message": err.Error()})
		return false
	}
	const probe = "speakmore 自检"
	wrote := board.writeText(probe, true) == nil
	text, _ := board.readText()
	wroteText := wrote && text == probe
	markedTransient := wrote && board.hasFormat(board.exclude)
	restored := board.restore(before) == nil
	after, _ := board.snapshot()
	same := restored && sameEntries(before, after)
	emit(event{"event": "selftest", "wrote_text": wroteText, "marked_transient": markedTransient, "restored": same, "items": len(before)})
	return wroteText && markedTransient && same
}

// 两份剪贴板内容一样不一样：格式的先后不算，系统可能按自己的顺序列
func sameEntries(a, b []clipboardEntry) bool {
	if len(a) != len(b) {
		return false
	}
	byFormat := map[uint32]string{}
	for _, entry := range a {
		byFormat[entry.format] = string(entry.data)
	}
	for _, entry := range b {
		if data, ok := byFormat[entry.format]; !ok || data != string(entry.data) {
			return false
		}
	}
	return true
}

func main() {
	runtime.LockOSThread()
	go func() {
		writer := bufio.NewWriter(os.Stdout)
		for line := range out {
			writer.Write(line)
			if len(out) == 0 {
				writer.Flush()
			}
		}
	}()
	exit := func(code int) {
		// 等写完再退：出错的那一行不能丢
		for len(out) > 0 {
			time.Sleep(10 * time.Millisecond)
		}
		time.Sleep(20 * time.Millisecond)
		os.Exit(code)
	}

	name := "right_alt"
	args := os.Args[1:]
	for i, arg := range args {
		if arg == "--key" {
			if i+1 < len(args) {
				name = args[i+1]
			} else {
				name = ""
			}
		}
	}
	vk, ok := hotkeys[name]
	if !ok {
		emit(event{"event": "error", "message": "不认识的热键 " + name + "，可选：right_alt、right_control"})
		exit(2)
	}
	state.hotkey = vk

	has := func(flag string) bool {
		for _, arg := range args {
			if arg == flag {
				return true
			}
		}
		return false
	}
	// Windows 没有"输入监控""辅助功能"这两项权限
	if has("--check") {
		emit(event{"event": "check", "listen": true, "trusted": true})
		exit(0)
	}

	window = createMessageWindow()
	if window == 0 {
		emit(event{"event": "error", "message": "建不了消息窗口"})
		exit(1)
	}
	board = newClipboard(window)
	if has("--selftest") {
		if selfTest() {
			exit(0)
		}
		exit(1)
	}

	// --no-prompt 照收不误：Windows 上没有授权框可弹
	keyboard := installHook(whKeyboardLL, keyboardCallback)
	listening := keyboard != 0
	emit(event{"event": "ready", "listen": listening, "trusted": true, "capture": listening})

	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		// 一次贴的字可能很长：放宽到 16 MB
		scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
		for scanner.Scan() {
			handle(append([]byte(nil), scanner.Bytes()...))
		}
		if err := scanner.Err(); err != nil {
			emit(event{"event": "error", "message": "读标准输入出错：" + err.Error()})
		}
		exit(0)
	}()

	var m msg
	for {
		result, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(result) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
	exit(0)
}
