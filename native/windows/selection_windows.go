package main

// selection 命令：取前台应用里选中的文字，给划词翻译。先问 UI Automation（uia_windows.go）：记事本、Word、
// Edge 和 Chrome 的网页与输入框都支持，还能给出选区在屏幕上的位置、在不在能改的地方。问不到（应用不支持 TextPattern、
// 选区是空的）再模拟一次 Ctrl+C，从剪贴板里拿，拿完把剪贴板原样还回去；这条路拿不到位置。
// 都不在钩子线程上等：问 UIA 在它自己的线程上，等修饰键松开、等剪贴板变化在一个 goroutine 里轮询，
// 只有碰剪贴板和发按键那几下交给钩子线程（剪贴板要消息窗口当主人，和贴字一样）。

import (
	"fmt"
	"time"
	"unsafe"
)

const (
	// 问 UIA 最多等多久：正常几十毫秒，第一次要加载 UIAutomationCore 慢一些；再久多半是前台应用卡住了
	uiaTimeout = 1200 * time.Millisecond
	// 模拟复制前最多等多久让用户松开修饰键：他是按右 Alt+回车触发的，右 Alt 还按着时发 Ctrl+C，
	// 应用看到的是 Ctrl+Alt+C（AltGr+C），有的布局会打出字来
	modifierWait = time.Second
	// 发了 Ctrl+C 以后最多等多久剪贴板变：应用一般几十毫秒内就写好了
	copyWait = 400 * time.Millisecond
	pollStep = 15 * time.Millisecond

	vkC = 0x43
)

var (
	procGetClipboardSequenceNumber = user32.NewProc("GetClipboardSequenceNumber")
	procGetGUIThreadInfo           = user32.NewProc("GetGUIThreadInfo")
)

// 同一时间只取一次：两次的模拟复制交叠的话，剪贴板会被还原成另一次存下的东西
var selectionTurn = make(chan struct{}, 1)

// 在一个 goroutine 里取，取完回一条 selection。不挡着读标准输入，也不挡着钩子线程
func handleSelection(id int) {
	go func() {
		selectionTurn <- struct{}{}
		defer func() { <-selectionTurn }()
		started := time.Now()
		result := readSelection()
		e := selectionEvent(id, result)
		// 用了多久：父进程记日志用（选中的文字不进日志，长度、位置有没有、能不能改、用时都在这一条里）
		e["ms"] = time.Since(started).Milliseconds()
		emit(e)
	}()
}

func readSelection() selection {
	if foregroundBlocksInput() {
		// 管理员窗口：UIA 问不进去，模拟的 Ctrl+C 也会被系统悄悄拦下
		return selection{Via: "uia", Reason: "elevated"}
	}
	reading, err := uiaRead(uiaTimeout)
	if err == errUIATimeout {
		// 前台应用卡住了：它也不会理模拟的 Ctrl+C，不再试
		emit(event{"event": "error", "message": fmt.Sprintf("取选区时 UI Automation %d 毫秒没回，前台应用可能卡住了", uiaTimeout.Milliseconds())})
		return selection{Via: "uia", Reason: "failed"}
	}
	if err != nil {
		// 意料之外的失败照实报，再走模拟复制，不让这一次白按
		emit(event{"event": "error", "message": "取选区时 UI Automation 出错，改用模拟复制：" + err.Error()})
	}
	if reading.text != "" {
		result := selection{Text: reading.text, Editable: judgeEditable(reading.clues), Via: "uia"}
		if rect, ok := unionRects(reading.rects); ok {
			result.Rect = &rect
		}
		return result
	}
	return copySelection(reading.clues)
}

// ---------- 模拟复制 ----------

// 模拟复制取选区。clues 是 UIA 在焦点元素上问到的那几样（可能什么都没有），再加上有没有系统光标，判能不能改
func copySelection(clues editableClues) selection {
	waitModifiersReleased()
	type started struct {
		saved    []clipboardEntry
		sequence uintptr
		caret    bool
		result   *selection
	}
	begin := make(chan started, 1)
	onUIThread(func() {
		if foregroundBlocksInput() {
			begin <- started{result: &selection{Via: "copy", Reason: "elevated"}}
			return
		}
		saved, err := board.snapshot()
		if err != nil {
			// 存不下就还原不了：不能为了取个选区把用户剪贴板里的东西换掉
			emit(event{"event": "error", "message": "取选区：存不下剪贴板，不模拟复制：" + err.Error()})
			begin <- started{result: &selection{Via: "copy", Reason: "failed"}}
			return
		}
		sequence, _, _ := procGetClipboardSequenceNumber.Call()
		caret := foregroundHasCaret()
		if !sendKeys([]uint16{vkControl, vkC, vkC, vkControl}, []bool{true, true, false, false}) {
			emit(event{"event": "error", "message": "取选区：模拟 Ctrl+C 没发出去"})
			begin <- started{result: &selection{Via: "copy", Reason: "failed"}}
			return
		}
		begin <- started{saved: saved, sequence: sequence, caret: caret}
	})
	first := <-begin
	if first.result != nil {
		return *first.result
	}

	changed := false
	for waited := time.Duration(0); waited < copyWait; waited += pollStep {
		time.Sleep(pollStep)
		if now, _, _ := procGetClipboardSequenceNumber.Call(); now != first.sequence {
			changed = true
			break
		}
	}
	if !changed {
		// 没选中（大多数应用这时 Ctrl+C 什么都不做），或者应用不认 Ctrl+C。剪贴板没动过，不用还原
		return selection{Via: "copy", Reason: "none"}
	}

	finish := make(chan selection, 1)
	onUIThread(func() {
		text, _ := board.readText()
		if err := board.restore(first.saved); err != nil {
			emit(event{"event": "error", "message": "取选区：还原不了剪贴板：" + err.Error()})
		}
		clues.caret = first.caret
		finish <- selection{Text: text, Editable: judgeEditable(clues), Via: "copy", Reason: "none"}
	})
	return <-finish
}

// 等 Alt、Ctrl、Shift、Win 都松开，最多等 modifierWait；等不到也照发（用户一直按着，只能这样）
func waitModifiersReleased() {
	modifiers := []uintptr{vkLMenu, vkRMenu, vkLControl, vkRControl, vkLShift, vkRShift, vkLWin, vkRWin}
	for waited := time.Duration(0); waited < modifierWait; waited += pollStep {
		held := false
		for _, vk := range modifiers {
			if state, _, _ := procGetAsyncKeyState.Call(vk); state&0x8000 != 0 {
				held = true
				break
			}
		}
		if !held {
			return
		}
		time.Sleep(pollStep)
	}
}

// GUITHREADINFO 在 x64 上的布局（WinUser.h）
type guiThreadInfo struct {
	size        uint32
	flags       uint32
	active      uintptr
	focus       uintptr
	capture     uintptr
	menuOwner   uintptr
	moveSize    uintptr
	caret       uintptr
	caretLeft   int32
	caretTop    int32
	caretRight  int32
	caretBottom int32
}

// 前台窗口的线程有没有系统光标：Win32 的输入框、记事本有，网页正文、资源管理器没有。粗判"能不能改"
func foregroundHasCaret() bool {
	foreground, _, _ := procGetForegroundWindow.Call()
	if foreground == 0 {
		return false
	}
	thread, _, _ := procGetWindowThreadProcess.Call(foreground, 0)
	info := guiThreadInfo{}
	info.size = uint32(unsafe.Sizeof(info))
	if ok, _, _ := procGetGUIThreadInfo.Call(thread, uintptr(unsafe.Pointer(&info))); ok == 0 {
		return false
	}
	return info.caret != 0
}
