package main

// 用到的 Win32 接口。只用标准库的 syscall 按名字取，不引第三方包。结构体照 WinUser.h 在 x64 上的布局。

import (
	"fmt"
	"syscall"
	"unsafe"
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	advapi32 = syscall.NewLazyDLL("advapi32.dll")
	wtsapi32 = syscall.NewLazyDLL("wtsapi32.dll")

	procSetWindowsHookExW                 = user32.NewProc("SetWindowsHookExW")
	procUnhookWindowsHookEx               = user32.NewProc("UnhookWindowsHookEx")
	procCallNextHookEx                    = user32.NewProc("CallNextHookEx")
	procGetMessageW                       = user32.NewProc("GetMessageW")
	procTranslateMessage                  = user32.NewProc("TranslateMessage")
	procDispatchMessageW                  = user32.NewProc("DispatchMessageW")
	procPostMessageW                      = user32.NewProc("PostMessageW")
	procRegisterClassExW                  = user32.NewProc("RegisterClassExW")
	procCreateWindowExW                   = user32.NewProc("CreateWindowExW")
	procDefWindowProcW                    = user32.NewProc("DefWindowProcW")
	procSendInput                         = user32.NewProc("SendInput")
	procGetAsyncKeyState                  = user32.NewProc("GetAsyncKeyState")
	procOpenClipboard                     = user32.NewProc("OpenClipboard")
	procCloseClipboard                    = user32.NewProc("CloseClipboard")
	procEmptyClipboard                    = user32.NewProc("EmptyClipboard")
	procEnumClipboardFormats              = user32.NewProc("EnumClipboardFormats")
	procGetClipboardData                  = user32.NewProc("GetClipboardData")
	procSetClipboardData                  = user32.NewProc("SetClipboardData")
	procIsClipboardFormatAvail            = user32.NewProc("IsClipboardFormatAvailable")
	procRegisterClipboardFormat           = user32.NewProc("RegisterClipboardFormatW")
	procGetForegroundWindow               = user32.NewProc("GetForegroundWindow")
	procGetClassNameW                     = user32.NewProc("GetClassNameW")
	procGetWindowThreadProcess            = user32.NewProc("GetWindowThreadProcessId")
	procMapVirtualKeyW                    = user32.NewProc("MapVirtualKeyW")
	procMapVirtualKeyExW                  = user32.NewProc("MapVirtualKeyExW")
	procGetKeyboardLayout                 = user32.NewProc("GetKeyboardLayout")
	procRegisterHotKey                    = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey                  = user32.NewProc("UnregisterHotKey")
	procSetWinEventHook                   = user32.NewProc("SetWinEventHook")
	procRegisterSuspendResumeNotification = user32.NewProc("RegisterSuspendResumeNotification")

	procWTSRegisterSessionNotification = wtsapi32.NewProc("WTSRegisterSessionNotification")

	procGetModuleHandleW  = kernel32.NewProc("GetModuleHandleW")
	procGlobalAlloc       = kernel32.NewProc("GlobalAlloc")
	procGlobalFree        = kernel32.NewProc("GlobalFree")
	procGlobalLock        = kernel32.NewProc("GlobalLock")
	procGlobalUnlock      = kernel32.NewProc("GlobalUnlock")
	procGlobalSize        = kernel32.NewProc("GlobalSize")
	procOpenProcess       = kernel32.NewProc("OpenProcess")
	procCloseHandle       = kernel32.NewProc("CloseHandle")
	procGetCurrentProcess = kernel32.NewProc("GetCurrentProcess")

	procOpenProcessToken    = advapi32.NewProc("OpenProcessToken")
	procGetTokenInformation = advapi32.NewProc("GetTokenInformation")
)

const (
	whKeyboardLL = 13
	whMouseLL    = 14

	wmKeyDown     = 0x0100
	wmKeyUp       = 0x0101
	wmSysKeyDown  = 0x0104
	wmSysKeyUp    = 0x0105
	wmLButtonDown = 0x0201
	wmLButtonUp   = 0x0202
	wmApp         = 0x8000

	// 睡眠唤醒（RegisterSuspendResumeNotification 登记过的窗口才收得到：只收消息的窗口收不到广播）
	wmPowerBroadcast         = 0x0218
	pbtAPMSuspend            = 0x0004
	pbtAPMResumeAutomatic    = 0x0012 // 不管是不是人叫醒的，醒来都有这一条
	deviceNotifyWindowHandle = 0
	// 锁屏解锁、切换用户（WTSRegisterSessionNotification）
	wmWTSSessionChange   = 0x02B1
	notifyForThisSession = 0
	wtsConsoleConnect    = 0x1
	wtsConsoleDisconnect = 0x2
	wtsRemoteConnect     = 0x3
	wtsRemoteDisconnect  = 0x4
	wtsSessionLock       = 0x7
	wtsSessionUnlock     = 0x8
	// 前台换了窗口（SetWinEventHook）
	eventSystemForeground = 0x0003
	wineventOutOfContext  = 0x0000

	mapvkVSCToVKEx = 3 // 扫描码换 vk，分左右；高字节写 0xE0 是扩展键
	mapvkVKToVSCEx = 4

	llkhfExtended = 0x01 // KBDLLHOOKSTRUCT.flags：扫描码带 0xE0 前缀的键

	inputKeyboard  = 1
	keyEventFKeyUp = 0x0002

	cfUnicodeText = 13
	gmemMoveable  = 0x0002

	processQueryLimitedInformation = 0x1000
	tokenQuery                     = 0x0008
	tokenElevationClass            = 20
)

// 消息窗口的父窗口填这个：只收消息、不显示（HWND_MESSAGE = -3）
var hwndMessage = ^uintptr(2)

// 我们自己模拟的按键带着这个记号（dwExtraInfo），钩子据此认出来、原样放行。只认自己的：
// 别的工具（PowerToys 改键、AutoHotkey）模拟的键也带"模拟"标志，那些是用户要的，照常算
const ourMark = 0x53504B48 // "SPKH"

type kbdLLHookStruct struct {
	vkCode    uint32
	scanCode  uint32
	flags     uint32
	time      uint32
	extraInfo uintptr
}

type msLLHookStruct struct {
	x, y      int32
	mouseData uint32
	flags     uint32
	time      uint32
	extraInfo uintptr
}

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	x, y    int32
	private uint32
}

type wndClassEx struct {
	size       uint32
	style      uint32
	wndProc    uintptr
	clsExtra   int32
	wndExtra   int32
	instance   uintptr
	icon       uintptr
	cursor     uintptr
	background uintptr
	menuName   *uint16
	className  *uint16
	iconSm     uintptr
}

// INPUT 里的键盘那一种。联合体按最大的 MOUSEINPUT 算，整个结构 40 字节
type keyboardInput struct {
	kind  uint32
	_     uint32
	vk    uint16
	scan  uint16
	flags uint32
	time  uint32
	_     uint32
	extra uintptr
	_     [8]byte
}

func init() {
	if size := unsafe.Sizeof(keyboardInput{}); size != 40 {
		panic("keyboardInput 不是 40 字节，SendInput 会拒绝")
	}
}

// 按顺序模拟这几下按键（down 为 true 是按下）
func sendKeys(keys []uint16, downs []bool) bool {
	inputs := make([]keyboardInput, len(keys))
	for i, vk := range keys {
		inputs[i] = keyboardInput{kind: inputKeyboard, vk: vk, extra: ourMark}
		if !downs[i] {
			inputs[i].flags = keyEventFKeyUp
		}
	}
	sent, _, _ := procSendInput.Call(uintptr(len(inputs)), uintptr(unsafe.Pointer(&inputs[0])), unsafe.Sizeof(inputs[0]))
	return int(sent) == len(inputs)
}

func utf16Ptr(text string) *uint16 {
	p, err := syscall.UTF16PtrFromString(text)
	if err != nil {
		// 只有我们自己写死的名字会走这里，里面没有 NUL
		panic(err)
	}
	return p
}

// 进程是不是以管理员身份（提升过的令牌）在跑。打不开它的令牌也当成是：比我们权限高的进程才会这样，
// 系统同样不让模拟的按键进去
func processElevated(process uintptr) bool {
	var token uintptr
	if ok, _, _ := procOpenProcessToken.Call(process, tokenQuery, uintptr(unsafe.Pointer(&token))); ok == 0 {
		return true
	}
	defer procCloseHandle.Call(token)
	var elevated, returned uint32
	ok, _, _ := procGetTokenInformation.Call(token, tokenElevationClass, uintptr(unsafe.Pointer(&elevated)),
		unsafe.Sizeof(elevated), uintptr(unsafe.Pointer(&returned)))
	return ok != 0 && elevated != 0
}

// 前台窗口是不是以管理员身份运行、而我们不是：这时模拟的 Ctrl+V 会被系统悄悄拦下（UIPI）
func foregroundBlocksInput() bool {
	self, _, _ := procGetCurrentProcess.Call()
	if processElevated(self) {
		return false
	}
	window, _, _ := procGetForegroundWindow.Call()
	blocked, _ := windowBlocksInput(window)
	return blocked
}

// 前台窗口的类名；没有前台窗口、拿不到时是空的
func foregroundClass() string {
	window, _, _ := procGetForegroundWindow.Call()
	if window == 0 {
		return ""
	}
	var name [256]uint16
	length, _, _ := procGetClassNameW.Call(window, uintptr(unsafe.Pointer(&name[0])), uintptr(len(name)))
	return syscall.UTF16ToString(name[:length])
}

// 这个窗口所在的进程是不是以管理员身份运行（不管我们自己是不是），和它的进程号。
// 它收的按键我们的钩子看不到，我们模拟的按键也进不去
func windowBlocksInput(window uintptr) (bool, uint32) {
	if window == 0 {
		return false, 0
	}
	var pid uint32
	procGetWindowThreadProcess.Call(window, uintptr(unsafe.Pointer(&pid)))
	if pid == 0 {
		return false, 0
	}
	process, _, _ := procOpenProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if process == 0 {
		// 连这个都打不开的是受保护的系统进程，也不会接受我们的按键
		return true, pid
	}
	defer procCloseHandle.Call(process)
	return processElevated(process), pid
}

var (
	procSetProcessDpiAwarenessContext   = user32.NewProc("SetProcessDpiAwarenessContext")
	procGetThreadDpiAwarenessContext    = user32.NewProc("GetThreadDpiAwarenessContext")
	procGetAwarenessFromDpiAwarenessCtx = user32.NewProc("GetAwarenessFromDpiAwarenessContext")
	procSetProcessDPIAware              = user32.NewProc("SetProcessDPIAware")
)

// DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2，就是 (DPI_AWARENESS_CONTEXT)-4
var dpiPerMonitorAwareV2 = ^uintptr(3)

// DPI_AWARENESS 里的"按每块屏算"
const dpiAwarenessPerMonitor = 2

// 声明自己按每块屏的真实像素算：划词翻译要 UI Automation 报选区的位置，不声明的话系统会按 96 DPI 给这个进程换算一遍，
// 缩放不是 100% 的屏上位置就偏了。低级鼠标钩子报的本来就是物理像素（MSLLHOOKSTRUCT 的文档），悬浮条的点击区域照旧对得上。
// SetProcessDpiAwarenessContext 是 Windows 10 1703 起才有的，更老的系统退一步用 SetProcessDPIAware（按主屏算）。
// 已经被定下来的（清单、兼容性设置）改不了，系统回"拒绝访问"：已经是按每块屏算的就不用说，不是的照实报
func declareDPIAware() {
	if procSetProcessDpiAwarenessContext.Find() != nil {
		procSetProcessDPIAware.Call()
		return
	}
	ok, _, err := procSetProcessDpiAwarenessContext.Call(dpiPerMonitorAwareV2)
	if ok != 0 {
		return
	}
	context, _, _ := procGetThreadDpiAwarenessContext.Call()
	awareness, _, _ := procGetAwarenessFromDpiAwarenessCtx.Call(context)
	if int32(awareness) == dpiAwarenessPerMonitor {
		return
	}
	emit(event{"event": "error", "message": fmt.Sprintf("声明不了按每块屏的像素算（%v，现在是 %d），划词卡片在缩放过的屏上可能放偏", err, int32(awareness))})
}
