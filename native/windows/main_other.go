//go:build !windows

package main

import (
	"fmt"
	"os"
)

// 这个小帮手只给 Windows 用（macOS 的在 native/main.swift）。这里只是让纯逻辑的部分在别的系统上也能 go test
func main() {
	fmt.Fprintln(os.Stderr, "key-helper 只在 Windows 上运行")
	os.Exit(1)
}
