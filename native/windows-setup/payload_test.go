package main

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// fakeSetup 照 scripts/build/windows-setup.mjs 的拼法做一个假的安装程序：前面一段"程序"，后面接 zip 和记号
func fakeSetup(t *testing.T, files map[string]string, mangle func([]byte) []byte) string {
	t.Helper()
	var payload bytes.Buffer
	w := zip.NewWriter(&payload)
	for name, content := range files {
		f, err := w.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		f.Write([]byte(content))
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	trailer := make([]byte, trailerSize)
	copy(trailer, magic)
	binary.LittleEndian.PutUint64(trailer[len(magic):], uint64(payload.Len()))
	data := append(append([]byte("MZ 程序本身"), payload.Bytes()...), trailer...)
	if mangle != nil {
		data = mangle(data)
	}
	path := filepath.Join(t.TempDir(), "SpeakMore-Setup-x64.exe")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func open(t *testing.T, path string) (*zip.Reader, error) {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	return openPayload(f)
}

func TestPayloadUnpacksIntoTheDirectory(t *testing.T) {
	path := fakeSetup(t, map[string]string{
		"latest":                                "v0.9.0\n",
		"install.ps1":                           "& { 'hi' }",
		"v0.9.0/speakmore-win32-x64.zip":        "zip",
		"v0.9.0/speakmore-win32-x64.zip.sha256": "abc  speakmore-win32-x64.zip\n",
	}, nil)
	r, err := open(t, path)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := extract(r, dir); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dir, "v0.9.0", "speakmore-win32-x64.zip.sha256"))
	if err != nil || string(got) != "abc  speakmore-win32-x64.zip\n" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestPlainExeWithoutPayloadIsRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plain.exe")
	os.WriteFile(path, []byte("MZ 一个普通的程序，后面什么都没接"), 0o644)
	if _, err := open(t, path); err != errNoPayload {
		t.Fatalf("got %v", err)
	}
}

func TestTruncatedDownloadIsRejected(t *testing.T) {
	// 下载断在中间：记号还在最后（下了一半的文件没有记号），这里模拟长度对不上
	path := fakeSetup(t, map[string]string{"latest": "v0.9.0\n"}, func(data []byte) []byte {
		return append(data[:10], data[len(data)-trailerSize:]...)
	})
	if _, err := open(t, path); err == nil {
		t.Fatal("长度对不上的包被当成好的")
	}
}

func TestPathsOutsideTheDirectoryAreRefused(t *testing.T) {
	path := fakeSetup(t, map[string]string{"../escape.txt": "x"}, nil)
	r, err := open(t, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := extract(r, t.TempDir()); err == nil {
		t.Fatal("../ 开头的路径被解出来了")
	}
}
