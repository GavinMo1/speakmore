#!/bin/bash
# 生成一棵与原 dist 同结构的"可读树"（_work/readable/dist），作为 REA analyze_javascript_application 的输入：
# 被混淆的文件换成 webcrack 还原 + 导入改名后的版本，其余文件原样拷贝。
# 这是派生产物，不是原件；原件的结论以 _work/asar/dist 的分析为准。
# 用法：先跑 tools/deobfuscate.sh，再在 targets/typeless 下执行 tools/build-readable-tree.sh
set -euo pipefail

cd "$(dirname "$0")/.."
WORK="$PWD/_work"
SRC="$WORK/asar/dist"
DEOB="$WORK/deob"
OUT="$WORK/readable/dist"
export PATH="$WORK/tooling/node_modules/.bin:$PATH"

[ -d "$DEOB" ] || { echo "找不到 $DEOB，先跑 tools/deobfuscate.sh" >&2; exit 1; }
[ ! -e "$OUT" ] || { echo "$OUT 已存在，为避免混入旧文件请先移走" >&2; exit 1; }

replaced=0
copied=0
while IFS= read -r -d '' file; do
  rel="${file#"$SRC"/}"
  dest="$OUT/$rel"
  mkdir -p "$(dirname "$dest")"
  restored="$DEOB/${rel%.*}/deobfuscated.js"
  if [ -f "$restored" ]; then
    node tools/rename-imports.mjs "$restored" "$dest" >/dev/null
    replaced=$((replaced + 1))
  else
    cp "$file" "$dest"
    copied=$((copied + 1))
  fi
done < <(find "$SRC" -type f -print0)

echo "可读树已生成：${OUT}（还原替换 ${replaced} 个，原样拷贝 ${copied} 个）"
