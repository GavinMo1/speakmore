// SpeakMore 的 Windows 安装程序（SpeakMore-Setup-x64.exe）：双击就装好，装完打开 App 进首次引导。
//
// 它身上带着这个版本的程序包和 install.ps1（见 payload.go），解到临时目录，把那里当成下载地址跑 install.ps1：
// 怎么装只有 install.ps1 这一份，和 PowerShell 里 irm | iex 那一行装出来的一模一样，装的时候也不用联网。
// 控制台程序：安装的进度就是 install.ps1 打的那几行。出错时停住等按回车，免得窗口一闪就没了，看不到原因。
// 只用标准库；图标、版本信息和清单（asInvoker：不要管理员权限，不然名字里带 Setup 会被 Windows 自动要求提权）
// 由 scripts/build/windows-setup.mjs 编译时用 go-winres 生成。
package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// 和 src/cli/updater.mjs 跑 install.ps1 的写法一样：按 UTF-8 读进来当脚本块跑
// （直接 -File 的话，Windows PowerShell 5.1 把没有 BOM 的脚本当成系统编码读）
const runInstall = "& ([scriptblock]::Create([IO.File]::ReadAllText($env:SPEAKMORE_INSTALL_SCRIPT, [Text.Encoding]::UTF8))); exit $LASTEXITCODE"

func main() {
	setTitle("SpeakMore Setup")
	code := install()
	if code != 0 {
		fmt.Print("\n  Press Enter to close this window.")
		bufio.NewReader(os.Stdin).ReadString('\n')
	}
	os.Exit(code)
}

func install() int {
	dir, err := unpack()
	if dir != "" {
		defer os.RemoveAll(dir)
	}
	if err != nil {
		fmt.Printf("\n  x %v\n", err)
		return 1
	}
	version, err := os.ReadFile(filepath.Join(dir, "latest"))
	if err != nil {
		fmt.Printf("\n  x This setup file is damaged (%v); download it again.\n", err)
		return 1
	}
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", runInstall)
	cmd.Env = append(os.Environ(),
		"SPEAKMORE_INSTALL_SCRIPT="+filepath.Join(dir, "install.ps1"),
		"SPEAKMORE_INSTALL_BASE="+dir,
		"SPEAKMORE_VERSION="+strings.TrimSpace(string(version)),
		// 装完由这里打开 App；install.ps1 自己启动的是命令行那一份，会在终端里问 key
		"SPEAKMORE_NO_START=1",
	)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			return exit.ExitCode()
		}
		fmt.Printf("\n  x Couldn't run Windows PowerShell: %v\n", err)
		return 1
	}

	home := os.Getenv("SPEAKMORE_HOME")
	if home == "" {
		home = filepath.Join(os.Getenv("USERPROFILE"), ".speakmore")
	}
	if err := openApp(home); err != nil {
		fmt.Printf("  Couldn't open SpeakMore (%v). Open it from the Start menu.\n", err)
		return 0
	}
	fmt.Println("  Opening SpeakMore…")
	// 留一会儿让人看见装好了，再关窗口
	time.Sleep(3 * time.Second)
	return 0
}

// unpack 把身上带的东西解到一个新的临时目录，交出那个目录（出错时也交出来，好让调用的人删掉）
func unpack() (string, error) {
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	f, err := os.Open(self)
	if err != nil {
		return "", err
	}
	defer f.Close()
	payload, err := openPayload(f)
	if err != nil {
		return "", err
	}
	dir, err := os.MkdirTemp("", "speakmore-setup-")
	if err != nil {
		return "", err
	}
	return dir, extract(payload, dir)
}
