#!/usr/bin/env bash
# 用项目里装的魔搭（ModelScope）Python SDK 跑一个 Python 脚本：scripts/release/modelscope-sdk.sh <脚本.py> [参数…]
#
# SDK 装在 .tools/modelscope/venv（不进仓库），版本钉在旁边的 modelscope-requirements.txt；第一次跑时自己装（要有 uv）。
# SDK 默认往 ~/.modelscope、~/.cache/modelscope 写登录态和缓存，这里都指到 .tools/modelscope 里，不碰家目录。
# 令牌从环境变量 MODELSCOPE_API_TOKEN 来（with-modelscope-key.sh 喂），不落盘。
set -eo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
here="$root/.tools/modelscope"
venv="$here/venv"
lock="$root/scripts/release/modelscope-requirements.txt"

# 装过、而且装的就是锁定清单里的版本才跳过：清单改了重装
if [ ! -x "$venv/bin/python" ] || ! cmp -s "$lock" "$here/installed-requirements.txt"; then
  command -v uv >/dev/null || { echo "modelscope-sdk：要先装 uv（https://docs.astral.sh/uv/）" >&2; exit 1; }
  echo "modelscope-sdk：装魔搭 SDK 到 $venv" >&2
  export UV_CACHE_DIR="$here/uv-cache"
  uv venv --quiet --allow-existing --python 3.12 "$venv"
  uv pip install --quiet --python "$venv/bin/python" -r "$lock"
  cp "$lock" "$here/installed-requirements.txt"
fi

export MODELSCOPE_HOME="$here/home" MODELSCOPE_CACHE="$here/cache"
exec "$venv/bin/python" -I "$@"
