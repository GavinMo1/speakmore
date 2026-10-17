#!/bin/sh
# 把工作区现在的样子（受版本管理的，加上还没提交、没被忽略的新文件）同步到 Windows 开发机的
# %USERPROFILE%\speakmore-dev\repo，那边装好的 node_modules 留着不动：
#
#   scripts/dev/win-sync.sh
#
# 连法同 win.sh（.machine.env 的 WIN_SSH_TARGET、WIN_SSH_KEY）。Windows 10 1803 起自带 tar.exe，不用装别的。
# 开发机上的东西全在 speakmore-dev 里（代码、npm 和 Electron 的缓存），不用了整个删掉就干净。
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
# shellcheck source=/dev/null
. "$root/.machine.env"
key="$(printf '%s' "$WIN_SSH_KEY" | sed "s|^~|$HOME|")"

"$here/win.sh" '$d = "$HOME\speakmore-dev\repo"; New-Item -ItemType Directory -Force $d | Out-Null; Get-ChildItem -Force $d | Where-Object Name -ne "node_modules" | Remove-Item -Recurse -Force' >/dev/null
cd "$root"
# 只传文件（被删掉的跟踪文件 ls-files 还会列出来，tar 找不到会报错）。
# 编好的 Windows 小帮手不进 git，在 Mac 上交叉编译（node scripts/build/build-native.mjs --windows），
# 有就连同它的指纹一起带过去：那边从源码启动时看指纹对得上，就不会去找 Go 重编
{
  git ls-files -co --exclude-standard -z
  for built in build/key-helper.exe build/key-helper.exe.source-sha256; do [ -f "$built" ] && printf '%s\0' "$built"; done
} | xargs -0 sh -c 'for f; do [ -f "$f" ] && printf "%s\0" "$f"; done' sh |
  COPYFILE_DISABLE=1 tar --null -T - -czf - |
  ssh -o ConnectTimeout=10 -o BatchMode=yes -o IdentitiesOnly=yes -i "$key" "$WIN_SSH_TARGET" \
    'tar -xzf - -C %USERPROFILE%\speakmore-dev\repo'
echo "win-sync：同步好了"
