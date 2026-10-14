#!/bin/sh
# 从 assets 里的 svg 重新生成图标：icon.svg → icon.icns（应用图标），tray.svg → trayTemplate.png 和 @2x（菜单栏）。
# 改了图标才需要跑，生成的文件是提交进仓库的。
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
# 菜单栏图标照 Typeless 的尺寸：16 和 32（@2x）。文件名带 Template，macOS 才会按菜单栏深浅反色
rsvg-convert -w 16 -h 16 assets/tray.svg -o assets/trayTemplate.png
rsvg-convert -w 32 -h 32 assets/tray.svg -o assets/trayTemplate@2x.png
echo "生成了 assets/icon.icns、assets/trayTemplate.png、assets/trayTemplate@2x.png"
