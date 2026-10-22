package main

// 钩子交给纯逻辑的键盘事件，和纯逻辑交回来的处理结果。热键怎么认在 matcher.go，悬浮条上的点击在 capture.go。

// 虚拟键码（WinUser.h）
const (
	vkShift    = 0x10 // 不分左右的三个：别的程序模拟按键时可能只填这个
	vkControl  = 0x11
	vkMenu     = 0x12 // Alt
	vkLShift   = 0xA0
	vkRShift   = 0xA1
	vkLControl = 0xA2
	vkRControl = 0xA3
	vkLMenu    = 0xA4
	vkRMenu    = 0xA5 // 右 Alt
	vkLWin     = 0x5B
	vkRWin     = 0x5C
	vkV        = 0x56
	// 没有分配给任何键的键码。按住 Alt 或 Win 再松开，很多应用会把焦点交给菜单栏（Office 还会亮出按键提示）、
	// 系统会弹开始菜单；这中间插一下这个键，系统就当成"Alt、Win 加别的键"，松开时不再去开菜单。
	// AutoHotkey 文档推荐的也是它（它自己默认用左 Ctrl）
	vkMask = 0xE8
)

// 不是哪个物理键的 vk：VK_PACKET（模拟输入 Unicode 字符，扫描码那一栏放的是字符本身）、VK_PROCESSKEY（输入法改写过的）、
// 0xFF（Raw Input 的假键、PowerToys 的哑键）、0x07（手柄的 Xbox 键）、0xE8（掩码，别的工具也插）。
// 它们的扫描码不能当成键的身份（字符 '9' 的码正好是空格的扫描码），一律当成"别的键"，也不让绑
var virtualVKs = map[uint32]bool{0xE7: true, 0xE5: true, 0xFF: true, 0x07: true, vkMask: true}

// 驱动补的假修饰键，扫描码带这一位，不是用户按的（AutoHotkey keyboard_mouse.h 的 SC_FAKE_*）：
//   - 用了 AltGr 的布局（德语等）上按右 Alt，先补一个假的左 Ctrl（0x21D）；
//   - NumLock 开着时按着 Shift 按小键盘的双功能键，先补一个假的 Shift 松开（0x22A、0x236）；补回来的按下只有中间
//     又按了别的键时是假的，没按别的键时用正常扫描码（匹配器怎么对付这一对，见 matcher.fakeReleased）
const fakeScanBit = 0x200

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

// 钩子拿到的事件补成匹配器认的样子。别的程序模拟的按键不一定填全（docs/hotkey-research.md 4.2）：
//   - 修饰键只给了不分左右的 vk：按扫描码和扩展位分出左右（右 Shift 的扫描码是 0x36，右 Ctrl、右 Alt 带扩展位）；
//   - 普通键扫描码是 0（只填了 vk）：由 scanOf 按 vk 查一个（MapVirtualKeyW 的 MAPVK_VK_TO_VSC_EX）。
func normalize(in keyInput, scanOf func(vk uint32) (scan uint32, extended bool)) keyInput {
	switch in.vk {
	case vkShift:
		in.vk = vkLShift
		if in.scan&0xFF == 0x36 {
			in.vk = vkRShift
		}
	case vkControl:
		in.vk = vkLControl
		if in.extended {
			in.vk = vkRControl
		}
	case vkMenu:
		in.vk = vkLMenu
		if in.extended {
			in.vk = vkRMenu
		}
	}
	if in.scan == 0 && in.vk != 0 && !modifierVKs[in.vk] && !virtualVKs[in.vk] {
		in.scan, in.extended = scanOf(in.vk)
	}
	return in
}

type outcome struct {
	swallow bool
	events  []event
	// 要不要插一下 vkMask（见上）
	mask bool
}
