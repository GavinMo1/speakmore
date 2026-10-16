#!/usr/bin/env bash
# 带着腾讯云 COS 的密钥跑一条命令（把发布包、官网的图、本地模型传上去时用）。密钥只进这一条命令的进程，
# 不留在当前 shell 里，也不出现在命令行参数里。
#
#   scripts/release/with-cos-key.sh <命令…>        比如：scripts/release/with-cos-key.sh npm run publish-release
#
# 传到哪个桶（COS_BUCKET、COS_REGION）和密钥从哪来，都读本机配置 .machine.env：
# 桶名里带着账号的编号，凭据叫什么、加载器在哪每台机器不一样，所以都不写进仓库。
# 密钥按这个顺序找：
#   1. 环境里已经有 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY，直接用
#   2. .machine.env 里填了凭据名（COS_CREDENTIAL），用按需加载器的 withkey 喂给这条命令。
#      加载器是 COS_SECRETS_LOADER，没填就用 SECRETS_LOADER
set -eo pipefail

[ $# -gt 0 ] || { echo "用法：$0 <命令…>" >&2; exit 2; }

root="$(cd "$(dirname "$0")/../.." && pwd)"
config="$root/.machine.env"

fail() {
  echo "with-cos-key：$1" >&2
  echo "  照 .machine.env.example 配好 .machine.env 里的 COS_BUCKET、COS_REGION 和 COS_CREDENTIAL" >&2
  exit 1
}

[ -f "$config" ] || fail "没有本机配置 $config"
# 环境里已经给了的以环境为准，配置只补没给的
bucket="${COS_BUCKET:-}" region="${COS_REGION:-}" media="${SITE_MEDIA_BUCKET:-}" models="${MODELS_BUCKET:-}"
# shellcheck source=/dev/null
. "$config"
export COS_BUCKET="${bucket:-${COS_BUCKET:-}}" COS_REGION="${region:-${COS_REGION:-}}"
# 官网图片的桶（website/scripts/upload-media.mjs），没配也不影响发布
export SITE_MEDIA_BUCKET="${media:-${SITE_MEDIA_BUCKET:-}}"
# 本地模型的国内源（scripts/release/sync-models.mjs），没配也不影响发布
export MODELS_BUCKET="${models:-${MODELS_BUCKET:-}}"
[ -n "$COS_BUCKET" ] && [ -n "$COS_REGION" ] || fail "$config 里的 COS_BUCKET 或 COS_REGION 是空的"

if [ -n "${TENCENTCLOUD_SECRET_ID:-}" ] && [ -n "${TENCENTCLOUD_SECRET_KEY:-}" ]; then exec "$@"; fi

loader="${COS_SECRETS_LOADER:-${SECRETS_LOADER:-}}"
[ -n "$loader" ] && [ -n "${COS_CREDENTIAL:-}" ] || fail "环境里没有腾讯云的密钥，$config 里的加载器或 COS_CREDENTIAL 也是空的"
loader="${loader/#\~/$HOME}"
[ -f "$loader" ] || fail "找不到加载器 $loader"
# shellcheck source=/dev/null
. "$loader"
command -v withkey >/dev/null || fail "加载器里没有定义 withkey"

withkey "$COS_CREDENTIAL" "$@"
