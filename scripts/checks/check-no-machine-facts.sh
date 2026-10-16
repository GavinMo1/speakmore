#!/usr/bin/env bash
# 查本机特有的东西有没有漏进会进 git 的地方，有命中就以非零退出。
#
#   scripts/checks/check-no-machine-facts.sh
#
# 拿去查的字样都是运行时从本机取的，脚本本身不含任何一台机器的情况：
#   - .machine.env 里填的凭据名、加载器路径、发布桶和官网图片桶的名字、签名证书的名字
#   - 家目录的绝对路径
#   - .machine.env 配了 GIT_EMAIL 时：全局 git 配置里的那个邮箱（它不该出现在这个仓库里）
# 查的范围：工作区里会进 git 的文件（已跟踪的和还没加进去的）、全部分支的提交信息和作者邮箱、
# 全部分支历史上出现过的文件内容。
set -eo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
config=".machine.env"

# 取配置里某一项的值。在子 shell 里按 shell 的规矩读，和用这份配置的其他脚本读到的一样：
# 值两边的引号不算在内（照字面抠出来的话引号会跟着，带引号的字样在仓库里永远搜不到，等于没查）
setting() {
  [ -f "$config" ] || return 0
  # shellcheck source=/dev/null
  (set +u; . "./$config"; eval "printf '%s' \"\${$1:-}\"")
}

needles=()
# 太短的字样会到处误报，不查
add() { [ ${#1} -ge 4 ] && needles+=("$1"); return 0; }

for name in SECRETS_LOADER GEMINI_CREDENTIAL OPENAI_CREDENTIAL DEEPSEEK_CREDENTIAL COS_SECRETS_LOADER COS_CREDENTIAL COS_BUCKET SITE_MEDIA_BUCKET; do
  value="$(setting "$name")"
  add "$value"
  # 路径有两种写法，都查：写成 ~ 开头的，和展开成家目录的
  expanded="${value/#\~/$HOME}"
  collapsed="${expanded/#$HOME/\~}"
  [ "$expanded" != "$value" ] && add "$expanded"
  [ "$collapsed" != "$value" ] && add "$collapsed"
done
add "$HOME"
# 签名证书的名字："Developer ID Application: 名字 (团队号)"。整串、名字、团队号分开查
identity="$(setting MAC_SIGNING_IDENTITY)"
add "$identity"
add "$(printf '%s' "$identity" | sed -nE 's/^[^:]*: (.*) \(([A-Z0-9]+)\)$/\1/p')"
add "$(printf '%s' "$identity" | sed -nE 's/^[^:]*: (.*) \(([A-Z0-9]+)\)$/\2/p')"

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
  # 现在的文件里没有，不等于历史上没有过：哪个提交加进或删掉过这个字样，都列出来
  touched="$(git log --all --oneline -S"$needle")"
  if [ -n "$touched" ]; then
    echo "下面这些提交的文件内容里出现过本机的字样（要改写历史才去得掉）：" >&2
    echo "$touched" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "check-no-machine-facts：上面这些地方带着本机的情况，改成 .machine.env 的变量名再提交。" >&2
  exit 1
fi
echo "check-no-machine-facts：查了 ${#needles[@]} 个字样，没有漏进仓库。"
