package main

// selection 命令：取前台应用里选中的文字，给划词翻译。先问 UI Automation（uia_windows.go）：记事本、Word、
// Edge 和 Chrome 的网页与输入框都支持，还能给出选区在屏幕上的位置。问不到（应用不支持 TextPattern、
// 没有 TextPattern）再模拟一次 Ctrl+C，从剪贴板里拿，拿完把剪贴板原样还回去；这条路拿不到位置。
// 有 TextPattern、选区是空的，或者前台是终端，就是没选中，不发 Ctrl+C（selection.go 的 copyFallbackAllowed）。
// 都不在钩子线程上等：问 UIA 在它自己的线程上，等修饰键松开、等剪贴板变化在一个 goroutine 里轮询，
// 只有碰剪贴板和发按键那几下交给钩子线程（剪贴板要消息窗口当主人，和贴字一样）。
// 模拟复制和贴字排在同一条剪贴板的活里（clipboard_windows.go 的 clipboardJobs）。

import (
	"fmt"
	"time"
)

const (
	// 问 UIA 最多等多久：正常几十毫秒，第一次要加载 UIAutomationCore 慢一些；再久多半是前台应用卡住了
	uiaTimeout = 1200 * time.Millisecond
	// 模拟复制前最多等多久让用户松开修饰键：他是按右 Alt+回车触发的，右 Alt 还按着时发 Ctrl+C，
	// 应用看到的是 Ctrl+Alt+C（AltGr+C），有的布局会打出字来
	modifierWait = time.Second
	// 发了 Ctrl+C 以后最多等多久剪贴板变：应用一般几十毫秒内就写好了
	copyWait = 400 * time.Millisecond
	// 到点没变先回没选中，再多盯这么久：慢的应用（远程桌面、正忙的 IDE）过了点才写进剪贴板，写了就还原
	lateCopyWait = 1500 * time.Millisecond
	pollStep     = 15 * time.Millisecond

	vkC = 0x43
)

var (
	procGetClipboardSequenceNumber = user32.NewProc("GetClipboardSequenceNumber")
)

// 同一时间只取一次：UIA 一次问一个（模拟复制另外排在剪贴板的活里）
var selectionTurn = make(chan struct{}, 1)

// 在一个 goroutine 里取，取完回一条 selection。不挡着读标准输入，也不挡着钩子线程
func handleSelection(id int) {
	go func() {
		selectionTurn <- struct{}{}
		defer func() { <-selectionTurn }()
		started := time.Now()
		result := readSelection()
		e := selectionEvent(id, result)
		// 用了多久：父进程记日志用（选中的文字不进日志，长度、位置有没有、用时都在这一条里）
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
		// 意料之外的失败照实报，能模拟复制的再试一次，不让这一次白按
		emit(event{"event": "error", "message": "取选区时 UI Automation 出错：" + err.Error()})
	}
	if reading.text != "" {
		result := selection{Text: reading.text, Via: "uia"}
		if rect, ok := unionRects(reading.rects); ok {
			result.Rect = &rect
		}
		return result
	}
	if !copyFallbackAllowed(err == nil && reading.pattern, foregroundClass()) {
		return selection{Via: "uia", Reason: "none"}
	}
	return copySelection()
}

// ---------- 模拟复制 ----------

// 模拟复制取选区：拿不到位置。排在剪贴板的活里，回了结果以后可能还占着一会儿（等晚到的复制好还原）
func copySelection() selection {
	waitModifiersReleased()
	reply := make(chan selection, 1)
	clipboardJobs <- func() { copyInTurn(reply) }
	return <-reply
}

func copyInTurn(reply chan<- selection) {
	var saved []clipboardEntry
	var sequence uintptr
	var stopped *selection
	onUIThreadWait(func() {
		if foregroundBlocksInput() {
			stopped = &selection{Via: "copy", Reason: "elevated"}
			return
		}
		var err error
		if saved, err = board.snapshot(); err != nil {
			// 存不下就还原不了：不能为了取个选区把用户剪贴板里的东西换掉
			emit(event{"event": "error", "message": "取选区：存不下剪贴板，不模拟复制：" + err.Error()})
			stopped = &selection{Via: "copy", Reason: "failed"}
			return
		}
		sequence, _, _ = procGetClipboardSequenceNumber.Call()
		if !sendKeys([]uint16{vkControl, vkC, vkC, vkControl}, []bool{true, true, false, false}) {
			emit(event{"event": "error", "message": "取选区：模拟 Ctrl+C 没发出去"})
			stopped = &selection{Via: "copy", Reason: "failed"}
		}
	})
	if stopped != nil {
		reply <- *stopped
		return
	}
	restore := func() {
		if err := board.restore(saved); err != nil {
			emit(event{"event": "error", "message": "取选区：还原不了剪贴板：" + err.Error()})
		}
	}

	if !clipboardChanges(sequence, copyWait) {
		// 没选中（大多数应用这时 Ctrl+C 什么都不做），或者应用不认 Ctrl+C、慢了
		reply <- selection{Via: "copy", Reason: "none"}
		if clipboardChanges(sequence, lateCopyWait) {
			onUIThreadWait(restore)
		}
		return
	}
	var result selection
	onUIThreadWait(func() {
		text, err := board.readText()
		restore()
		if err != nil {
			emit(event{"event": "error", "message": "取选区：复制出来了，但读不出剪贴板：" + err.Error()})
			result = selection{Via: "copy", Reason: "failed"}
			return
		}
		// 复制出来的不是文字（图片、文件）也算没选中字
		result = selection{Text: text, Via: "copy", Reason: "none"}
	})
	reply <- result
}

// 剪贴板在 limit 以内变没变（序号和 sequence 不一样了）
func clipboardChanges(sequence uintptr, limit time.Duration) bool {
	for waited := time.Duration(0); waited < limit; waited += pollStep {
		time.Sleep(pollStep)
		if now, _, _ := procGetClipboardSequenceNumber.Call(); now != sequence {
			return true
		}
	}
	return false
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
