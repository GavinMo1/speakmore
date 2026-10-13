#!/bin/sh
# 打包并装进"应用程序"，然后打开。已经装过的会被换掉，正在运行的先退出。
# 用法：npm run install-app
set -eu
cd "$(dirname "$0")/.."
name="$(node -p "require('./package.json').productName")"
target="/Applications/$name.app"

npm run dist
built="dist/$name-darwin-$(node -p process.arch)/$name.app"

# 正在运行的那个要先退出，不然换不掉；没在运行时 pkill 返回非零，属于正常
pkill -x "$name" || true
rm -rf "$target"
ditto "$built" "$target"
echo "装好了：$target"
open "$target"
