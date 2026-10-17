package main

// 剪贴板：存下现在的、写入要贴的文字、贴完原样还回去（同 macOS 版：图片、文件、富文本都能还回去）。
// Windows 的剪贴板一次只能有一个窗口打开，所以这些都在消息窗口那个线程上做，打开时带上它当主人
// （不带主人的话 EmptyClipboard 之后 SetClipboardData 会失败）。

import (
	"errors"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// 不是一块内存、而是 GDI 句柄的几种格式：拷不了字节，跳过。图片另有 CF_DIB / CF_DIBV5 两种字节格式，
// 系统会互相转换，图片照样还得回去
func isHandleFormat(format uint32) bool {
	switch format {
	case 2 /* CF_BITMAP */, 3 /* CF_METAFILEPICT */, 9 /* CF_PALETTE */, 14, /* CF_ENHMETAFILE */
		0x80 /* CF_OWNERDISPLAY */, 0x82 /* CF_DSPBITMAP */, 0x83 /* CF_DSPMETAFILEPICT */, 0x8E /* CF_DSPENHMETAFILE */ :
		return true
	}
	// CF_GDIOBJFIRST..CF_GDIOBJLAST：私有的 GDI 句柄
	return format >= 0x300 && format <= 0x3FF
}

type clipboardEntry struct {
	format uint32
	data   []byte
}

type clipboard struct {
	owner uintptr
	// 剪贴板管理工具、系统的"剪贴板历史"和云同步认的约定：带这些格式的内容是临时的，不要记、不要传
	exclude, history, cloud uint32
}

func newClipboard(owner uintptr) *clipboard {
	register := func(name string) uint32 {
		format, _, _ := procRegisterClipboardFormat.Call(uintptr(unsafe.Pointer(utf16Ptr(name))))
		return uint32(format)
	}
	return &clipboard{
		owner:   owner,
		exclude: register("ExcludeClipboardContentFromMonitorProcessing"),
		history: register("CanIncludeInClipboardHistory"),
		cloud:   register("CanUploadToCloudClipboard"),
	}
}

// 打开剪贴板。别的程序正开着它时会失败，等几下再试；不能久等：同一个线程还要处理键盘钩子
func (c *clipboard) open() error {
	for attempt := 0; attempt < 10; attempt++ {
		if ok, _, _ := procOpenClipboard.Call(c.owner); ok != 0 {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return errors.New("剪贴板被别的程序占着")
}

func (c *clipboard) close() { procCloseClipboard.Call() }

// 一块全局内存里的字节
func globalBytes(handle uintptr) ([]byte, bool) {
	size, _, _ := procGlobalSize.Call(handle)
	pointer, _, _ := procGlobalLock.Call(handle)
	if pointer == 0 {
		return nil, false
	}
	defer procGlobalUnlock.Call(handle)
	data := make([]byte, size)
	copy(data, unsafe.Slice((*byte)(unsafe.Pointer(pointer)), size))
	return data, true
}

// 把字节放进剪贴板的一种格式。成功之后那块内存归系统，失败了要自己释放
func (c *clipboard) put(format uint32, data []byte) bool {
	size := len(data)
	if size == 0 {
		// 有的格式只看"有没有"，内容是空的；GlobalAlloc 不收 0 字节
		size = 1
	}
	handle, _, _ := procGlobalAlloc.Call(gmemMoveable, uintptr(size))
	if handle == 0 {
		return false
	}
	pointer, _, _ := procGlobalLock.Call(handle)
	if pointer == 0 {
		procGlobalFree.Call(handle)
		return false
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(pointer)), size), data)
	procGlobalUnlock.Call(handle)
	if ok, _, _ := procSetClipboardData.Call(uintptr(format), handle); ok == 0 {
		procGlobalFree.Call(handle)
		return false
	}
	return true
}

// 剪贴板里现在每一种能拷的格式
func (c *clipboard) snapshot() ([]clipboardEntry, error) {
	if err := c.open(); err != nil {
		return nil, err
	}
	defer c.close()
	var entries []clipboardEntry
	for format := uint32(0); ; {
		next, _, _ := procEnumClipboardFormats.Call(uintptr(format))
		if next == 0 {
			break
		}
		format = uint32(next)
		if isHandleFormat(format) {
			continue
		}
		handle, _, _ := procGetClipboardData.Call(uintptr(format))
		if handle == 0 {
			continue
		}
		if data, ok := globalBytes(handle); ok {
			entries = append(entries, clipboardEntry{format, data})
		}
	}
	return entries, nil
}

func (c *clipboard) restore(entries []clipboardEntry) error {
	if err := c.open(); err != nil {
		return err
	}
	defer c.close()
	procEmptyClipboard.Call()
	for _, entry := range entries {
		c.put(entry.format, entry.data)
	}
	return nil
}

// 文字按 CF_UNICODETEXT 的样子：UTF-16、以 0 结尾。文字里不会有 NUL（真有的话截在那里）
func utf16Bytes(text string) []byte {
	if i := strings.IndexByte(text, 0); i >= 0 {
		text = text[:i]
	}
	units, _ := syscall.UTF16FromString(text)
	return unsafe.Slice((*byte)(unsafe.Pointer(&units[0])), len(units)*2)
}

// 写入文字。transient：标上"临时的"，剪贴板历史、云同步、剪贴板管理工具都不记它（贴完马上就还回去了）
func (c *clipboard) writeText(text string, transient bool) error {
	if err := c.open(); err != nil {
		return err
	}
	defer c.close()
	procEmptyClipboard.Call()
	if !c.put(cfUnicodeText, utf16Bytes(text)) {
		return errors.New("写不进剪贴板")
	}
	if transient {
		zero := []byte{0, 0, 0, 0}
		c.put(c.exclude, zero)
		c.put(c.history, zero)
		c.put(c.cloud, zero)
	}
	return nil
}

// 读出剪贴板里的文字（自检用）
func (c *clipboard) readText() (string, bool) {
	if err := c.open(); err != nil {
		return "", false
	}
	defer c.close()
	handle, _, _ := procGetClipboardData.Call(cfUnicodeText)
	if handle == 0 {
		return "", false
	}
	data, ok := globalBytes(handle)
	if !ok || len(data) < 2 {
		return "", false
	}
	return syscall.UTF16ToString(unsafe.Slice((*uint16)(unsafe.Pointer(&data[0])), len(data)/2)), true
}

func (c *clipboard) hasFormat(format uint32) bool {
	ok, _, _ := procIsClipboardFormatAvail.Call(uintptr(format))
	return ok != 0
}
