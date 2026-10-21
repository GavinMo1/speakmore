package main

// 钩子交给纯逻辑的键盘事件，和纯逻辑交回来的处理结果。热键怎么认在 matcher.go，悬浮条上的点击在 capture.go。

// 虚拟键码（WinUser.h）
const (
	vkLControl = 0xA2
	vkRControl = 0xA3
	vkRMenu    = 0xA5 // 右 Alt
	// 没有分配给任何键的键码。按住 Alt 或 Win 再松开，很多应用会把焦点交给菜单栏（Office 还会亮出按键提示）、
	// 系统会弹开始菜单；按下这类绑定时插一下这个键，系统就当成"Alt、Win 加别的键"，松开时不再去开菜单。
	// AutoHotkey 文档推荐的也是它
	vkMask = 0xE8
)

// 用了 AltGr 的键盘布局（德语等）上，按右 Alt 系统会先补一个假的左 Ctrl，扫描码是这个。它不是用户按的别的键
const altGrFakeCtrlScan = 0x21D

// 一个键盘事件
type keyInput struct {
	vk       uint32
	scan     uint32
	extended bool // LLKHF_EXTENDED：扫描码带 0xE0 前缀的键（右 Ctrl、方向键……）
	down     bool
	// 我们自己模拟的（插的 vkMask、贴字时的 Ctrl+V）：不算用户按的键，原样放行
	ours bool
	time uint32 // 毫秒（KBDLLHOOKSTRUCT.time）
}

type outcome struct {
	swallow bool
	events  []event
	// 要不要插一下 vkMask（见上）。不能在钩子里直接插：回到消息循环里再插
	mask bool
}
