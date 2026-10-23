package main

// 用 UI Automation 读前台应用里选中的文字（划词翻译）。纯标准库：COM 接口按 vtable 下标直接调，不引第三方包。
// 下标照 mingw-w64 的 uiautomationclient.h（2026-10-22 的 master）里各接口的 Vtbl 结构数的，前三个是 IUnknown 的
// QueryInterface、AddRef、Release：
//   IUIAutomation                 8 GetFocusedElement、14 get_ControlViewWalker
//   IUIAutomationElement          14 GetCurrentPatternAs
//   IUIAutomationTreeWalker       3 GetParentElement
//   IUIAutomationTextPattern      5 GetSelection
//   IUIAutomationTextRangeArray   3 get_Length、4 GetElement
//   IUIAutomationTextRange        10 GetBoundingRectangles、12 GetText
// 调用都在一个专门的线程上（uiaWorker）：跨进程问前台应用，应用卡住时会跟着卡，不能放在键盘钩子的线程上。
// 应用卡死、到点没回的，那个线程就丢下不管（它回来以后自己退出），下一次另起一个。

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

var (
	ole32    = syscall.NewLazyDLL("ole32.dll")
	oleaut32 = syscall.NewLazyDLL("oleaut32.dll")

	procCoInitializeEx        = ole32.NewProc("CoInitializeEx")
	procCoUninitialize        = ole32.NewProc("CoUninitialize")
	procCoCreateInstance      = ole32.NewProc("CoCreateInstance")
	procSysStringLen          = oleaut32.NewProc("SysStringLen")
	procSysFreeString         = oleaut32.NewProc("SysFreeString")
	procSafeArrayGetLBound    = oleaut32.NewProc("SafeArrayGetLBound")
	procSafeArrayGetUBound    = oleaut32.NewProc("SafeArrayGetUBound")
	procSafeArrayAccessData   = oleaut32.NewProc("SafeArrayAccessData")
	procSafeArrayUnaccessData = oleaut32.NewProc("SafeArrayUnaccessData")
	procSafeArrayDestroy      = oleaut32.NewProc("SafeArrayDestroy")
)

type guid struct {
	data1 uint32
	data2 uint16
	data3 uint16
	data4 [8]byte
}

// 照 uiautomationclient.h 的 DEFINE_GUID
var (
	clsidCUIAutomation          = guid{0xff48dba4, 0x60ef, 0x4201, [8]byte{0xaa, 0x87, 0x54, 0x10, 0x3e, 0xef, 0x59, 0x4e}}
	iidIUIAutomation            = guid{0x30cbe57d, 0xd9d0, 0x452a, [8]byte{0xab, 0x13, 0x7a, 0xc5, 0xac, 0x48, 0x25, 0xee}}
	iidIUIAutomationTextPattern = guid{0x32eba289, 0x3583, 0x42c9, [8]byte{0x9c, 0x59, 0x3b, 0x6d, 0x9a, 0x1e, 0x9b, 0x6a}}
)

const (
	coinitMultithreaded = 0x0
	clsctxInprocServer  = 0x1
	rpcEChangedMode     = 0x80010106

	uiaTextPatternID = 10014

	// 选中的文字往上找几层祖先去找 TextPattern：网页里焦点停在链接上、选的却是旁边正文时，TextPattern 在文档上
	maxTextPatternHops = 4
)

// 一个 COM 接口指针。指向的是系统分配的内存，不归 Go 管，存成 uintptr
type comPtr uintptr

// vtable 第 index 个方法的地址
func (p comPtr) method(index int) uintptr {
	vtable := *(*uintptr)(unsafe.Pointer(p))
	return *(*uintptr)(unsafe.Pointer(vtable + uintptr(index)*unsafe.Sizeof(uintptr(0))))
}

func (p comPtr) release() {
	if p != 0 {
		syscall.SyscallN(p.method(2), uintptr(p))
	}
}

func failed(hr uintptr) bool { return int32(hr) < 0 }

type hresultError struct {
	what string
	hr   uintptr
}

func (e hresultError) Error() string {
	return fmt.Sprintf("%s 失败（HRESULT 0x%08X）", e.what, uint32(e.hr))
}

// BSTR 读成字符串，读完释放。BSTR 前面记着长度，里面可能有 NUL，不能按 NUL 结尾读
func takeBSTR(bstr uintptr) string {
	if bstr == 0 {
		return ""
	}
	defer procSysFreeString.Call(bstr)
	n, _, _ := procSysStringLen.Call(bstr)
	if n == 0 {
		return ""
	}
	return string(utf16.Decode(unsafe.Slice((*uint16)(unsafe.Pointer(bstr)), n)))
}

// 一维 double 的 SAFEARRAY 读成切片，读完销毁
func takeDoubles(array uintptr) []float64 {
	if array == 0 {
		return nil
	}
	defer procSafeArrayDestroy.Call(array)
	var lower, upper int32
	if hr, _, _ := procSafeArrayGetLBound.Call(array, 1, uintptr(unsafe.Pointer(&lower))); failed(hr) {
		return nil
	}
	if hr, _, _ := procSafeArrayGetUBound.Call(array, 1, uintptr(unsafe.Pointer(&upper))); failed(hr) {
		return nil
	}
	count := int(upper - lower + 1)
	if count <= 0 {
		return nil
	}
	var data uintptr
	if hr, _, _ := procSafeArrayAccessData.Call(array, uintptr(unsafe.Pointer(&data))); failed(hr) || data == 0 {
		return nil
	}
	defer procSafeArrayUnaccessData.Call(array)
	return append([]float64(nil), unsafe.Slice((*float64)(unsafe.Pointer(data)), count)...)
}

// UIA 读到的：选中的文字、各段的外接矩形
type uiaReading struct {
	text  string
	rects []float64
}

// 焦点元素上取一种模式（GetCurrentPatternAs 顺带做了 QueryInterface）；不支持是 0
func patternOf(element comPtr, patternID uintptr, iid *guid) comPtr {
	var pattern comPtr
	hr, _, _ := syscall.SyscallN(element.method(14), uintptr(element), patternID, uintptr(unsafe.Pointer(iid)),
		uintptr(unsafe.Pointer(&pattern)))
	if failed(hr) {
		return 0
	}
	return pattern
}

// 读一次焦点元素上的选区。前台应用不支持 TextPattern 时 text 是空的、err 是 nil（交给模拟复制）；
// err 只给意料之外的失败
func readFocused(automation comPtr) (uiaReading, error) {
	var reading uiaReading
	var focused comPtr
	if hr, _, _ := syscall.SyscallN(automation.method(8), uintptr(automation), uintptr(unsafe.Pointer(&focused))); failed(hr) {
		return reading, hresultError{"GetFocusedElement", hr}
	}
	if focused == 0 {
		return reading, nil
	}
	defer focused.release()

	text := textPatternNear(automation, focused)
	if text == 0 {
		return reading, nil
	}
	defer text.release()
	var ranges comPtr
	if hr, _, _ := syscall.SyscallN(text.method(5), uintptr(text), uintptr(unsafe.Pointer(&ranges))); failed(hr) {
		return reading, hresultError{"TextPattern.GetSelection", hr}
	}
	if ranges == 0 {
		return reading, nil
	}
	defer ranges.release()
	var length int32
	if hr, _, _ := syscall.SyscallN(ranges.method(3), uintptr(ranges), uintptr(unsafe.Pointer(&length))); failed(hr) {
		return reading, hresultError{"TextRangeArray.get_Length", hr}
	}
	var parts []string
	for i := int32(0); i < length; i++ {
		var item comPtr
		if hr, _, _ := syscall.SyscallN(ranges.method(4), uintptr(ranges), uintptr(i), uintptr(unsafe.Pointer(&item))); failed(hr) || item == 0 {
			continue
		}
		part, rects := readRange(item)
		item.release()
		if part == "" {
			continue
		}
		parts = append(parts, part)
		reading.rects = append(reading.rects, rects...)
	}
	for i, part := range parts {
		if i > 0 {
			reading.text += "\n"
		}
		reading.text += part
	}
	return reading, nil
}

// 焦点元素自己，或者往上几层祖先里第一个有 TextPattern 的
func textPatternNear(automation, focused comPtr) comPtr {
	if text := patternOf(focused, uiaTextPatternID, &iidIUIAutomationTextPattern); text != 0 {
		return text
	}
	var walker comPtr
	if hr, _, _ := syscall.SyscallN(automation.method(14), uintptr(automation), uintptr(unsafe.Pointer(&walker))); failed(hr) || walker == 0 {
		return 0
	}
	defer walker.release()
	current := focused
	for hop := 0; hop < maxTextPatternHops; hop++ {
		var parent comPtr
		hr, _, _ := syscall.SyscallN(walker.method(3), uintptr(walker), uintptr(current), uintptr(unsafe.Pointer(&parent)))
		if current != focused {
			current.release()
		}
		if failed(hr) || parent == 0 {
			return 0
		}
		current = parent
		if text := patternOf(current, uiaTextPatternID, &iidIUIAutomationTextPattern); text != 0 {
			current.release()
			return text
		}
	}
	if current != focused {
		current.release()
	}
	return 0
}

// 一段选区的文字、外接矩形。文字最多读 maxSelectionUnits 再多两个单元：
// 截的时候按字符截（clipUTF16），多读的两个单元保证劈开的代理对落在截掉的那头
func readRange(item comPtr) (string, []float64) {
	var bstr uintptr
	hr, _, _ := syscall.SyscallN(item.method(12), uintptr(item), uintptr(maxSelectionUnits+2), uintptr(unsafe.Pointer(&bstr)))
	if failed(hr) {
		return "", nil
	}
	text := takeBSTR(bstr)
	if text == "" {
		return "", nil
	}
	var array uintptr
	var rects []float64
	if hr, _, _ := syscall.SyscallN(item.method(10), uintptr(item), uintptr(unsafe.Pointer(&array))); !failed(hr) {
		rects = takeDoubles(array)
	}
	return text, rects
}

// ---------- 专门的线程 ----------

type uiaAnswer struct {
	reading uiaReading
	err     error
}

var (
	uiaMu sync.Mutex
	// 现在那个线程收活的口子；到点没回的线程被丢下时清空，下一次另起
	uiaJobs chan chan uiaAnswer
)

var errUIATimeout = errors.New("UI Automation 到点没回")

func startUIAWorker() chan chan uiaAnswer {
	jobs := make(chan chan uiaAnswer)
	go func() {
		// 不解锁：COM 的状态跟着这个系统线程，goroutine 结束时线程一起退掉，干净
		runtime.LockOSThread()
		hr, _, _ := procCoInitializeEx.Call(0, coinitMultithreaded)
		if failed(hr) && uint32(hr) != rpcEChangedMode {
			for done := range jobs {
				done <- uiaAnswer{err: hresultError{"CoInitializeEx", hr}}
			}
			return
		}
		defer procCoUninitialize.Call()
		var automation comPtr
		defer func() { automation.release() }()
		for done := range jobs {
			if automation == 0 {
				hr, _, _ := procCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidCUIAutomation)), 0, clsctxInprocServer,
					uintptr(unsafe.Pointer(&iidIUIAutomation)), uintptr(unsafe.Pointer(&automation)))
				if failed(hr) || automation == 0 {
					automation = 0
					done <- uiaAnswer{err: hresultError{"CoCreateInstance(CUIAutomation)", hr}}
					continue
				}
			}
			reading, err := readFocused(automation)
			done <- uiaAnswer{reading: reading, err: err}
		}
	}()
	return jobs
}

// 问一次 UIA，最多等 timeout。同一时间只有一次 selection 在问（selection_windows.go 排着队）
func uiaRead(timeout time.Duration) (uiaReading, error) {
	uiaMu.Lock()
	if uiaJobs == nil {
		uiaJobs = startUIAWorker()
	}
	jobs := uiaJobs
	uiaMu.Unlock()

	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	done := make(chan uiaAnswer, 1)
	select {
	case jobs <- done:
	case <-deadline.C:
		retireUIAWorker(jobs)
		return uiaReading{}, errUIATimeout
	}
	select {
	case answer := <-done:
		return answer.reading, answer.err
	case <-deadline.C:
		retireUIAWorker(jobs)
		return uiaReading{}, errUIATimeout
	}
}

// 丢下卡住的那个线程：关掉它的口子，它回来交完这一次就退出
func retireUIAWorker(jobs chan chan uiaAnswer) {
	uiaMu.Lock()
	defer uiaMu.Unlock()
	if uiaJobs == jobs {
		uiaJobs = nil
		close(jobs)
	}
}
