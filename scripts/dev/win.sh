#!/bin/sh
# 在 Windows 开发机上跑一段 PowerShell，输出按 UTF-8 拿回来：
#
#   scripts/dev/win.sh 'Get-Date'
#   scripts/dev/win.sh - < 脚本.ps1
#
# 连哪台、用哪把钥匙写在不进 git 的 .machine.env（WIN_SSH_TARGET、WIN_SSH_KEY）。
# 整段编成 UTF-16LE 的 base64 交给 powershell -EncodedCommand：登进去的默认 shell 是 cmd，
# 引号要过三层、中文按 GBK 出，编码之后一个字符都不用转义。错误记录转成纯文本，
# 不然输出被重定向时 PowerShell 把它序列化成一大段 CLIXML。
# 注意：从这里起的程序跑在 ssh 的会话里，进不了桌面，断开就被收掉；要起到桌面上的用计划任务（见 docs/development.md）。
set -eu

root="$(cd "$(dirname "$0")/../.." && pwd)"
config="$root/.machine.env"
[ -f "$config" ] || { echo "win.sh：没有本机配置 $config，照 .machine.env.example 填 WIN_SSH_TARGET、WIN_SSH_KEY" >&2; exit 1; }
# shellcheck source=/dev/null
. "$config"
[ -n "${WIN_SSH_TARGET:-}" ] && [ -n "${WIN_SSH_KEY:-}" ] || { echo "win.sh：$config 里的 WIN_SSH_TARGET 或 WIN_SSH_KEY 是空的" >&2; exit 1; }
key="$(printf '%s' "$WIN_SSH_KEY" | sed "s|^~|$HOME|")"

[ $# -eq 1 ] || { echo "用法：$0 '<PowerShell>'  或  $0 - < 脚本.ps1" >&2; exit 2; }
if [ "$1" = "-" ]; then body="$(cat)"; else body="$1"; fi

script="$(printf '[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$OutputEncoding = [Text.Encoding]::UTF8\n$ProgressPreference = "SilentlyContinue"\n& {\n%s\n} 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { "$_" } else { $_ } }\n' "$body")"
encoded="$(printf '%s' "$script" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')"
exec ssh -o ConnectTimeout=10 -o ServerAliveInterval=30 -o BatchMode=yes -o IdentitiesOnly=yes -i "$key" "$WIN_SSH_TARGET" \
  "powershell -NoProfile -NonInteractive -EncodedCommand $encoded"
