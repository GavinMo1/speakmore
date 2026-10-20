#!/usr/bin/env bash
# 带着魔搭（ModelScope）的令牌跑一条命令（把本地模型传到国内源时用）。令牌只进这一条命令的进程，
# 不留在当前 shell 里，也不出现在命令行参数里。
#
#   scripts/release/with-modelscope-key.sh <命令…>     比如：scripts/release/with-modelscope-key.sh npm run sync-models -- --from <目录>
#
# 令牌按这个顺序找：
#   1. 环境里已经有 MODELSCOPE_API_TOKEN，直接用
#   2. 本机配置 .machine.env 里填了凭据名（MODELSCOPE_CREDENTIAL），用按需加载器（SECRETS_LOADER）的 withkey 喂给这条命令
set -eo pipefail

[ $# -gt 0 ] || { echo "用法：$0 <命令…>" >&2; exit 2; }
[ -n "${MODELSCOPE_API_TOKEN:-}" ] && exec "$@"

root="$(cd "$(dirname "$0")/../.." && pwd)"
config="$root/.machine.env"
fail() {
  echo "with-modelscope-key：$1" >&2
  echo "  照 .machine.env.example 配好 .machine.env 里的 MODELSCOPE_CREDENTIAL 和 SECRETS_LOADER" >&2
  exit 1
}
[ -f "$config" ] || fail "没有本机配置 $config"
# shellcheck source=/dev/null
. "$config"
[ -n "${MODELSCOPE_CREDENTIAL:-}" ] || fail "$config 里的 MODELSCOPE_CREDENTIAL 是空的"
[ -f "${SECRETS_LOADER:-}" ] || fail "找不到加载器 SECRETS_LOADER（$SECRETS_LOADER）"
# shellcheck source=/dev/null
. "$SECRETS_LOADER"
withkey "$MODELSCOPE_CREDENTIAL" "$@"
