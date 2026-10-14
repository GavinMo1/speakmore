#!/bin/sh
# 从 assets/icon.svg 重新生成 assets/icon.icns。改了图标才需要跑，生成的 icns 是提交进仓库的。
# 需要 rsvg-convert（brew install librsvg）和系统自带的 iconutil。
set -eu
cd "$(dirname "$0")/../.."
iconset="$(mktemp -d)/icon.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  rsvg-convert -w "$size" -h "$size" assets/icon.svg -o "$iconset/icon_${size}x${size}.png"
  rsvg-convert -w "$((size * 2))" -h "$((size * 2))" assets/icon.svg -o "$iconset/icon_${size}x${size}@2x.png"
done
iconutil --convert icns "$iconset" --output assets/icon.icns
rm -rf "$(dirname "$iconset")"
echo "生成了 assets/icon.icns"
