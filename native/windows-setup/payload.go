package main

import (
	"archive/tar"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/klauspost/compress/zstd"
)

// 安装程序身上带的东西：exe 本身后面接一个 zstd 压过的 tar，里面就是要装的那棵树（app\ 和 runtime\，
// 和 versions\<版本> 里的样子一样），最后 16 个字节是记号和它的长度。
// 在 exe 后面接数据是自解压安装包的老办法，Windows 照常只运行前面那段程序。
// 拼的那一边是 scripts/build/windows-setup.mjs，两边的格式要一致。用 zstd 而不是 zip：小三成多，解得也快。

const (
	magic       = "SMSETUP2"
	trailerSize = 16
)

var errNoPayload = errors.New("this setup file is incomplete (no package inside); download it again")

// openPayload 找到 exe 后面接的那一段（压着的）
func openPayload(f *os.File) (io.Reader, error) {
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
	return io.NewSectionReader(f, size-trailerSize-n, n), nil
}

// extract 把那一段解到 dir。只认 dir 里面的相对路径，只认目录和普通文件：包是自己打的，但坏了的包不该写到别处去
func extract(r io.Reader, dir string) error {
	dec, err := zstd.NewReader(r)
	if err != nil {
		return err
	}
	defer dec.Close()
	tr := tar.NewReader(dec)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("this setup file is damaged (%v); download it again", err)
		}
		name := filepath.FromSlash(header.Name)
		if !filepath.IsLocal(name) {
			return fmt.Errorf("unexpected path in the package: %s", header.Name)
		}
		target := filepath.Join(dir, name)
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			if err := extractFile(tr, target); err != nil {
				return fmt.Errorf("unpacking %s: %w", header.Name, err)
			}
		default:
			return fmt.Errorf("unexpected entry in the package: %s", header.Name)
		}
	}
}

func extractFile(in io.Reader, target string) error {
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
