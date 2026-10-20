package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"syscall"

	"github.com/ncruces/zenity"
	"golang.org/x/sys/windows"
)

// 第一次安装时问装在哪：系统的对话框（装到这里 / 选择其他位置… / 取消），选位置用系统的文件夹选择框（zenity：
// 纯 Go 调 Win32，不要 cgo）。选的不能用就说为什么、再问一次。对话框弹不出来（极少见）时退到控制台里问

// uiWords 按 Windows 的显示语言
func uiWords() words {
	lang, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetUserDefaultUILanguage").Call()
	return wordsFor(uint16(lang))
}

// askWhere 交回选的文件夹（空的是默认位置）；点了取消交回 errCanceled
func askWhere(defaultHome string) (string, error) {
	w := uiWords()
	if !stdinIsConsole() {
		// 脚本调的（输入被重定向）：不弹框，装默认位置
		return "", nil
	}
	for {
		err := zenity.Question(fmt.Sprintf(w.question, defaultHome),
			zenity.Title(w.title), zenity.NoIcon,
			zenity.OKLabel(w.installHere), zenity.ExtraButton(w.choose), zenity.CancelLabel(w.cancel))
		switch {
		case err == nil:
			return "", nil
		case errors.Is(err, zenity.ErrCanceled):
			return "", errCanceled
		case !errors.Is(err, zenity.ErrExtraButton):
			return askInConsole(defaultHome, w)
		}
		picked, err := zenity.SelectFile(zenity.Directory(), zenity.Title(w.pickTitle), zenity.Filename(filepath.Dir(defaultHome)+`\`))
		if errors.Is(err, zenity.ErrCanceled) {
			continue
		}
		if err != nil {
			return askInConsole(defaultHome, w)
		}
		folder, problem := checkFolderAnswer(picked, w)
		if problem == "" {
			return folder, nil
		}
		zenity.Warning(problem, zenity.Title(w.title), zenity.OKLabel(w.again))
	}
}

// diskFormat 这个文件夹所在的那块盘是什么格式（NTFS、exFAT、FAT32…）；网络路径、问不到的是空的
func diskFormat(folder string) string {
	volume := filepath.VolumeName(folder)
	if len(volume) != 2 {
		return ""
	}
	root, err := windows.UTF16PtrFromString(volume + `\`)
	if err != nil {
		return ""
	}
	var name [windows.MAX_PATH + 1]uint16
	if windows.GetVolumeInformation(root, nil, 0, nil, nil, nil, &name[0], uint32(len(name))) != nil {
		return ""
	}
	return windows.UTF16ToString(name[:])
}
