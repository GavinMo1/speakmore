#!/bin/sh
# 发完版在 Windows 开发机上验收线上的包：把 accept-win.ps1 传过去跑（经 ssh，不碰桌面会话），跑完删掉。
# 先装上一个版本并开着，再照 README 里 irm 那一行升到最新，详见 accept-win.ps1。
#
#   scripts/release/accept-win.sh                 验 package.json 里的版本，从它前一个发过的版本升上来
#   scripts/release/accept-win.sh 0.17.1 0.17.0   验 0.17.1，从 0.17.0 升上来
#
# 连哪台、用哪把钥匙在 .machine.env 的 WIN_SSH_TARGET、WIN_SSH_KEY（见 docs/development.md 的 Windows 一节）。
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$root"

to="${1:-$(node -p "require('./package.json').version")}"
# 前一个发过的版本：按版本号排的标签里排在 v$to 后面的第一个正式版（不带 -rc 这类后缀）
from="${2:-$(git tag --list 'v*' --sort=-v:refname | grep -v -e '-' | awk -v cur="v$to" 'found { print; exit } $0 == cur { found = 1 }' | sed 's/^v//')}"
[ -n "$from" ] || { echo "accept-win：找不到 v$to 之前发过的版本，第二个参数写上从哪个版本升" >&2; exit 2; }
for value in "$to" "$from"; do
  case "$value" in *[!0-9.]*) echo "accept-win：版本号只认数字和点：$value" >&2; exit 2 ;; esac
done
echo "验 ${to}，从 ${from} 升上来"

# shellcheck source=/dev/null
. "$root/.machine.env"
key="$(printf '%s' "$WIN_SSH_KEY" | sed "s|^~|$HOME|")"
# 带上 BOM：Windows PowerShell 5.1 把没有 BOM 的 .ps1 当成系统编码（中文系统是 GBK）来读（同 scripts/dev/win-desktop.sh）
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
printf '\357\273\277' > "$body"
cat "$here/accept-win.ps1" >> "$body"
scp -q -o BatchMode=yes -o IdentitiesOnly=yes -i "$key" "$body" "${WIN_SSH_TARGET}:speakmore-dev/accept.ps1"
# 开发机不许直接跑 .ps1 文件（执行策略），只给这一次放行
"$root/scripts/dev/win.sh" "
\$f = \"\$HOME\\speakmore-dev\\accept.ps1\"
try { powershell -NoProfile -ExecutionPolicy Bypass -File \$f -From $from -To $to } finally { Remove-Item -LiteralPath \$f -ErrorAction SilentlyContinue }
"
