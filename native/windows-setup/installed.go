package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// installedApp 找出装好的那一份：家目录里的 current（install.ps1 写的）记着用 versions 下的哪个目录，
// 交出那个版本的 Electron 和程序目录。current 里不是一个目录名的（空的、带路径的），当没装好
func installedApp(home string) (exe string, app string, err error) {
	file := filepath.Join(home, "current")
	current, err := os.ReadFile(file)
	if err != nil {
		return "", "", err
	}
	name := strings.TrimSpace(string(current))
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `\/:`) {
		return "", "", fmt.Errorf("%s doesn't name an installed version", file)
	}
	version := filepath.Join(home, "versions", name)
	return filepath.Join(version, "runtime", "electron.exe"), filepath.Join(version, "app"), nil
}
