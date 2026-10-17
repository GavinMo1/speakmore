#!/usr/bin/env bash
# 带着某一家模型的 key 跑一条命令。key 只进这一条命令的进程，不留在当前 shell 里，也不出现在命令行参数里。
#
#   scripts/dev/with-key.sh <厂商> <命令…>       厂商：gemini / openai / deepseek / bailian（阿里云百炼）/ moonshot（Kimi）/ zhipu（智谱）/ minimax
#
# 以 openai 为例，key 按这个顺序找：
#   1. 环境里已经有 OPENAI_API_KEY，直接用
#   2. 本机配置 .machine.env 里填了按需加载器（SECRETS_LOADER）和凭据名（OPENAI_CREDENTIAL），
#      用加载器的 withkey 喂给这条命令
# 凭据叫什么、加载器在哪，每台机器不一样，所以只写在不进 git 的 .machine.env 里。
set -eo pipefail

usage() { echo "用法：$0 <gemini|openai|deepseek|bailian|moonshot|zhipu|minimax> <命令…>" >&2; exit 2; }
[ $# -gt 1 ] || usage
case "$1" in gemini | openai | deepseek | bailian | moonshot | zhipu | minimax) ;; *) usage ;; esac
provider="$(printf %s "$1" | tr '[:lower:]' '[:upper:]')"
shift
key_var="${provider}_API_KEY"
credential_var="${provider}_CREDENTIAL"

if [ -n "${!key_var:-}" ]; then exec "$@"; fi

root="$(cd "$(dirname "$0")/../.." && pwd)"
config="$root/.machine.env"

fail() {
  echo "with-key：$1" >&2
  echo "  要么先把 key 放进这条命令的环境：$key_var=… $0 … <命令…>" >&2
  echo "  要么照 .machine.env.example 配好 .machine.env 里的 SECRETS_LOADER 和 $credential_var" >&2
  exit 1
}

[ -f "$config" ] || fail "环境里没有 $key_var，也没有本机配置 $config"
# shellcheck source=/dev/null
. "$config"
[ -n "${SECRETS_LOADER:-}" ] && [ -n "${!credential_var:-}" ] || fail "$config 里的 SECRETS_LOADER 或 $credential_var 是空的"

loader="${SECRETS_LOADER/#\~/$HOME}"
[ -f "$loader" ] || fail "找不到加载器 $SECRETS_LOADER"
# shellcheck source=/dev/null
. "$loader"
command -v withkey >/dev/null || fail "$SECRETS_LOADER 里没有定义 withkey"

withkey "${!credential_var}" "$@"
