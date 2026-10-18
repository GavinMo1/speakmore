package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInstalledAppFollowsCurrent(t *testing.T) {
	home := t.TempDir()
	if err := os.WriteFile(filepath.Join(home, "current"), []byte("0.9.3-1a2b3c4d\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	exe, app, err := installedApp(home)
	if err != nil {
		t.Fatal(err)
	}
	version := filepath.Join(home, "versions", "0.9.3-1a2b3c4d")
	if exe != filepath.Join(version, "runtime", "electron.exe") || app != filepath.Join(version, "app") {
		t.Fatalf("got %q %q", exe, app)
	}
}

func TestInstalledAppRejectsMissingOrOddCurrent(t *testing.T) {
	home := t.TempDir()
	if _, _, err := installedApp(home); err == nil {
		t.Fatal("no current file: want an error")
	}
	for _, content := range []string{"", "  \r\n", "..", `..\..\Windows`, "a/b"} {
		if err := os.WriteFile(filepath.Join(home, "current"), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if exe, _, err := installedApp(home); err == nil {
			t.Fatalf("current = %q: want an error, got %q", content, exe)
		}
	}
}
