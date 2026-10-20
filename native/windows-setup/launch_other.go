//go:build !windows

package main

import "errors"

// 安装程序只在 Windows 上跑；这里让它在别的系统上也编得过，好在 Mac 上跑测试

func openApp(string) error { return errors.New("only on Windows") }

func setTitle(string) {}

func stdinIsConsole() bool { return false }
