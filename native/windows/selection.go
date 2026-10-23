package main

// 划词翻译要的选区（纯逻辑）：前台应用里选中的文字和它在屏幕上的位置，拼成回给父进程的那一条。
// 怎么取在 selection_windows.go（先 UI Automation，取不到再模拟 Ctrl+C），这里只管拿到的东西怎么整理。

import "unicode/utf16"

// 选中的文字最多带这么多个 UTF-16 单元：一行 JSON 不能没边，父进程那边本来也只翻得了一段
const maxSelectionUnits = 65536

// 屏幕上的一块：物理像素，和低级鼠标钩子、capture 的 regions 同一套坐标
type screenRect struct {
	X, Y, Width, Height float64
}

// 一次 selection 的结果
type selection struct {
	Text string
	// 选区的外接矩形；不知道是 nil（模拟复制拿到的就不知道）
	Rect *screenRect
	// uia 或 copy：最后用的是哪种
	Via string
	// 文字是空的时候为什么：none（没选中）、elevated（前台是管理员窗口）、failed（出错了）
	Reason string
}

func selectionEvent(id int, s selection) event {
	text := clipUTF16(s.Text, maxSelectionUnits)
	e := event{"event": "selection", "id": id, "text": text, "via": s.Via}
	if text == "" {
		// 没选到字时位置没有意义：父进程不该拿它去摆卡片
		reason := s.Reason
		if reason == "" {
			reason = "none"
		}
		e["reason"] = reason
		return e
	}
	if s.Rect != nil {
		e["rect"] = map[string]float64{"x": s.Rect.X, "y": s.Rect.Y, "width": s.Rect.Width, "height": s.Rect.Height}
	}
	return e
}

// 截到最多 max 个 UTF-16 单元。按字符截，不把一个表情这类要两个单元的字劈成两半
func clipUTF16(text string, max int) string {
	units := 0
	for i, r := range text {
		units += utf16.RuneLen(r)
		if units > max {
			return text[:i]
		}
	}
	return text
}

// UIA 的 GetBoundingRectangles 回的一串 double，每 4 个一块：left、top、width、height。多行选区一行一块，取并集。
// 宽或高是 0 的不算（折叠的选区、滚出视野的那几行有的应用这么报）。一块都不剩就是不知道位置
func unionRects(values []float64) (screenRect, bool) {
	var left, top, right, bottom float64
	found := false
	for i := 0; i+4 <= len(values); i += 4 {
		x, y, w, h := values[i], values[i+1], values[i+2], values[i+3]
		if w <= 0 || h <= 0 {
			continue
		}
		if !found {
			left, top, right, bottom = x, y, x+w, y+h
			found = true
			continue
		}
		left, top = min(left, x), min(top, y)
		right, bottom = max(right, x+w), max(bottom, y+h)
	}
	return screenRect{X: left, Y: top, Width: right - left, Height: bottom - top}, found
}
