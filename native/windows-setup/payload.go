package main

import (
	"archive/zip"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// 安装程序身上带的东西：exe 本身后面接一个 zip（只存不压），最后 16 个字节是记号和 zip 的长度。
// 在 exe 后面接数据是自解压安装包的老办法，Windows 照常只运行前面那段程序。
// 拼的那一边是 scripts/build/windows-setup.mjs，两边的格式要一致。

const (
	magic       = "SMSETUP1"
	trailerSize = 16
)

var errNoPayload = errors.New("this setup file is incomplete (no package inside); download it again")

// openPayload 找到 exe 后面接的那个 zip
func openPayload(f *os.File) (*zip.Reader, error) {
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	size := info.Size()
	if size < trailerSize {
		return nil, errNoPayload
	}
	trailer := make([]byte, trailerSize)
	if _, err := f.ReadAt(trailer, size-trailerSize); err != nil {
		return nil, err
	}
	if string(trailer[:len(magic)]) != magic {
		return nil, errNoPayload
	}
	n := int64(binary.LittleEndian.Uint64(trailer[len(magic):]))
	if n <= 0 || n > size-trailerSize {
		return nil, fmt.Errorf("this setup file is damaged (package size %d of %d); download it again", n, size)
	}
	return zip.NewReader(io.NewSectionReader(f, size-trailerSize-n, n), n)
}

// extract 把 zip 里的东西解到 dir。只认 dir 里面的相对路径：包是自己打的，但坏了的包不该写到别处去
func extract(r *zip.Reader, dir string) error {
	for _, entry := range r.File {
		name := filepath.FromSlash(entry.Name)
		if !filepath.IsLocal(name) {
			return fmt.Errorf("unexpected path in the package: %s", entry.Name)
		}
		target := filepath.Join(dir, name)
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := extractFile(entry, target); err != nil {
			return fmt.Errorf("unpacking %s: %w", entry.Name, err)
		}
	}
	return nil
}

func extractFile(entry *zip.File, target string) error {
	in, err := entry.Open()
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(target)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
