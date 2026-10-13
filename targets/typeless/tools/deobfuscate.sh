#!/bin/bash
# 把解包出来的 dist 里所有被 javascript-obfuscator 混淆的文件批量还原成可读代码。
# 依赖：_work/tooling 里局部安装的 node@24 + webcrack（webcrack 不支持本机的 Node 26）。
#   首次准备：mkdir -p _work/tooling && cd _work/tooling && npm init -y && npm i node@24 webcrack@2.16.0
# 用法：在 targets/typeless 下执行 tools/deobfuscate.sh
set -euo pipefail

cd "$(dirname "$0")/.."
WORK="$PWD/_work"
SRC="$WORK/asar/dist"
OUT="$WORK/deob"
export PATH="$WORK/tooling/node_modules/.bin:$PATH"

[ -d "$SRC" ] || { echo "找不到 $SRC，先跑 tools/asar-extract.mjs" >&2; exit 1; }
command -v webcrack >/dev/null || { echo "找不到 webcrack，见脚本头部的准备步骤" >&2; exit 1; }

failed=0
while IFS= read -r -d '' file; do
  rel="${file#"$SRC"/}"
  # 混淆过的文件里 _0x 标识符成百上千；没混淆的（语言包、第三方库）直接跳过
  # grep 无匹配时退出码为 1，在 pipefail 下会让脚本直接退出，所以单独兜住
  count=$({ grep -o '_0x[0-9a-f]\{4,6\}' "$file" || true; } | wc -l | tr -d ' ')
  [ "$count" -ge 50 ] || continue

  dest="$OUT/${rel%.*}"
  [ -f "$dest/deobfuscated.js" ] && continue
  mkdir -p "$(dirname "$dest")"
  # webcrack 只认 .js 输入，这里统一拷成临时 .js 再处理
  tmp="$dest.in.js"
  cp "$file" "$tmp"
  if webcrack "$tmp" --no-unpack --no-jsx -o "$dest" >"$dest.log" 2>&1; then
    printf 'ok   %-50s %8s -> %8s 字节\n' "$rel" "$(wc -c <"$file" | tr -d ' ')" "$(wc -c <"$dest/deobfuscated.js" | tr -d ' ')"
  else
    printf 'FAIL %-50s 详见 %s\n' "$rel" "$dest.log" >&2
    failed=$((failed + 1))
  fi
  rm -f "$tmp"
done < <(find "$SRC" -type f \( -name '*.js' -o -name '*.mjs' \) -print0)

[ "$failed" -eq 0 ] || { echo "有 $failed 个文件去混淆失败" >&2; exit 1; }
