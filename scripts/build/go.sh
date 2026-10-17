#!/bin/sh
# 用项目自带的 Go 跑一条 go 命令：scripts/build/go.sh build …
# Windows 的原生小帮手（native/windows/）用 Go 写，在 Mac 上交叉编译成 exe。Go 不装进系统：第一次用时下载
# 钉死的版本、核对 SHA-256，解进 .tools/go；模块缓存、编译缓存也在 .tools 里，删掉 .tools/go* 就干净了。
set -eu

VERSION=go1.27.2
# go.dev/dl/?mode=json 里这个版本两种芯片的 Mac 包的校验值
SHA256_arm64=76812b213b1b2302c978d28fa52fa92d541704b9e7d9d5db8002c50e4018c4c5
SHA256_amd64=587b59182488b23aa6e5fc25110405a3e0e5b38ed2f5b2f46ed13c32aee356fe

root="$(cd "$(dirname "$0")/../.." && pwd)"
tools="$root/.tools"
goroot="$tools/go"

if [ "$("$goroot/bin/go" env GOVERSION 2>/dev/null || true)" != "$VERSION" ]; then
  case "$(uname -m)" in
    arm64) arch=arm64 sha256=$SHA256_arm64 ;;
    x86_64) arch=amd64 sha256=$SHA256_amd64 ;;
    *) echo "go.sh：不认识的芯片 $(uname -m)" >&2; exit 1 ;;
  esac
  archive="$tools/$VERSION.darwin-$arch.tar.gz"
  mkdir -p "$tools"
  echo "go.sh：下载 ${VERSION}（只这一次）" >&2
  curl -fsSL --retry 2 -o "$archive" "https://go.dev/dl/$VERSION.darwin-$arch.tar.gz"
  actual="$(shasum -a 256 "$archive" | cut -d' ' -f1)"
  if [ "$actual" != "$sha256" ]; then
    rm -f "$archive"
    echo "go.sh：${VERSION} 的校验值对不上：应该是 ${sha256}，下到的是 ${actual}" >&2
    exit 1
  fi
  rm -rf "$goroot"
  tar -xzf "$archive" -C "$tools"
  rm -f "$archive"
fi

export GOROOT="$goroot"
export GOPATH="$tools/go-path"
export GOMODCACHE="$tools/go-path/pkg/mod"
export GOCACHE="$tools/go-cache"
# 不让 Go 自己去下别的版本的工具链
export GOTOOLCHAIN=local
exec "$goroot/bin/go" "$@"
