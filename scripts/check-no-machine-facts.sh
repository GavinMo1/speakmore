#!/usr/bin/env bash
# 查本机特有的东西有没有漏进会进 git 的地方，有命中就以非零退出。
#
#   scripts/check-no-machine-facts.sh
#
# 拿去查的字样都是运行时从本机取的，脚本本身不含任何一台机器的情况：
#   - .machine.env 里填的凭据名和加载器路径
#   - 家目录的绝对路径
#   - .machine.env 配了 GIT_EMAIL 时：全局 git 配置里的那个邮箱（它不该出现在这个仓库里）
# 查的范围：工作区里会进 git 的文件（已跟踪的和还没加进去的）、全部分支的提交信息和作者邮箱。
set -eo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
config=".machine.env"

# 取配置里某一项的原样写法，不 source：加载器路径要保留成 ~ 开头的样子去查
setting() {
  [ -f "$config" ] || return 0
  sed -n "s/^$1=//p" "$config" | tail -1
}

needles=()
# 太短的字样会到处误报，不查
add() { [ ${#1} -ge 4 ] && needles+=("$1"); return 0; }

for name in SECRETS_LOADER GEMINI_CREDENTIAL; do
  raw="$(setting "$name")"
  add "$raw"
  expanded="${raw/#\~/$HOME}"
  [ "$expanded" != "$raw" ] && add "$expanded"
done
add "$HOME"

failed=0
git_email="$(setting GIT_EMAIL)"
if [ -n "$git_email" ]; then
  current="$(git config user.email || true)"
  if [ "$current" != "$git_email" ]; then
    echo "这个仓库的提交邮箱现在是 ${current:-<没有设>}，本机配置要求用 ${git_email}。" >&2
    echo "  先执行：git config user.email '$git_email'" >&2
    failed=1
  fi
  global="$(git config --global user.email || true)"
  [ "$global" != "$git_email" ] && add "$global"
fi

for needle in "${needles[@]}"; do
  if git grep -nIF --untracked -e "$needle" -- .; then failed=1; fi
  if git log --all --format='%h %ae %ce%n%B' | grep -nF -e "$needle"; then failed=1; fi
done

if [ "$failed" -ne 0 ]; then
  echo "check-no-machine-facts：上面这些地方带着本机的情况，改成 .machine.env 的变量名再提交。" >&2
  exit 1
fi
echo "check-no-machine-facts：查了 ${#needles[@]} 个字样，没有漏进仓库。"
