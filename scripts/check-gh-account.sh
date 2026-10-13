#!/usr/bin/env bash
# 核对 gh 现在激活的账号是不是本项目该用的那个，不是就以非零退出，后面的命令不会执行。
#
#   scripts/check-gh-account.sh && git push …
#
# gh 的激活账号是整台机器共享的，别的终端一切换这里就跟着变，而 git 走 https 时凭据也取自它，
# 所以要紧挨着每次 GitHub 操作核对，不能沿用早先查过的结果。
# 该用哪个账号写在不进 git 的 .machine.env 里（GITHUB_ACCOUNT）；没配就不拦。
set -eo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
config="$root/.machine.env"
# shellcheck source=/dev/null
[ -f "$config" ] && . "$config"

if [ -z "${GITHUB_ACCOUNT:-}" ]; then
  echo "check-gh-account：.machine.env 里没有配 GITHUB_ACCOUNT，跳过核对" >&2
  exit 0
fi

active="$(gh api user --jq .login)"
if [ "$active" != "$GITHUB_ACCOUNT" ]; then
  echo "check-gh-account：gh 现在激活的是 ${active}，本项目要用 ${GITHUB_ACCOUNT}。" >&2
  echo "  先执行：gh auth switch --user $GITHUB_ACCOUNT" >&2
  exit 1
fi
