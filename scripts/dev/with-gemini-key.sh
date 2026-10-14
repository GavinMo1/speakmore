#!/usr/bin/env bash
# 带着 Gemini key 跑一条命令。key 只进这一条命令的进程，不留在当前 shell 里，也不出现在命令行参数里。
#
#   scripts/dev/with-gemini-key.sh <命令…>
#
# key 按这个顺序找：
#   1. 环境里已经有 GEMINI_API_KEY，直接用
#   2. 本机配置 .machine.env 里填了按需加载器（SECRETS_LOADER）和凭据名（GEMINI_CREDENTIAL），
#      用加载器的 withkey 喂给这条命令
# 凭据叫什么、加载器在哪，每台机器不一样，所以只写在不进 git 的 .machine.env 里。
set -eo pipefail

[ $# -gt 0 ] || { echo "用法：$0 <命令…>" >&2; exit 2; }

if [ -n "${GEMINI_API_KEY:-}" ]; then exec "$@"; fi

root="$(cd "$(dirname "$0")/../.." && pwd)"
config="$root/.machine.env"

fail() {
  echo "with-gemini-key：$1" >&2
  echo "  要么先把 key 放进这条命令的环境：GEMINI_API_KEY=… $0 <命令…>" >&2
  echo "  要么照 .machine.env.example 配好 .machine.env 里的 SECRETS_LOADER 和 GEMINI_CREDENTIAL" >&2
  exit 1
}

[ -f "$config" ] || fail "环境里没有 GEMINI_API_KEY，也没有本机配置 $config"
# shellcheck source=/dev/null
. "$config"
[ -n "${SECRETS_LOADER:-}" ] && [ -n "${GEMINI_CREDENTIAL:-}" ] || fail "$config 里的 SECRETS_LOADER 或 GEMINI_CREDENTIAL 是空的"

loader="${SECRETS_LOADER/#\~/$HOME}"
[ -f "$loader" ] || fail "找不到加载器 $SECRETS_LOADER"
# shellcheck source=/dev/null
. "$loader"
command -v withkey >/dev/null || fail "$SECRETS_LOADER 里没有定义 withkey"

withkey "$GEMINI_CREDENTIAL" "$@"
