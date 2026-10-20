//go:build !windows

package main

// 安装程序只在 Windows 上跑；这里让它在别的系统上也编得过，好在 Mac 上跑测试

func uiWords() words { return english }

func askWhere(defaultHome string) (string, error) { return askInConsole(defaultHome, english) }

func diskFormat(string) string { return "" }
