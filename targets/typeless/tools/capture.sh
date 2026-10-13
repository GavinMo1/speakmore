#!/bin/bash
# Typeless 抓包的开关脚本。原理见 capture_addon.py 顶部说明。
#
#   tools/capture.sh start [--decrypt-context]   起本机转发代理（前台运行，Ctrl-C 结束）
#   tools/capture.sh on                          让 Typeless 改连本机代理（改 app-settings.json，需重启 Typeless）
#   tools/capture.sh off                         恢复直连官方服务端（需重启 Typeless）
#   tools/capture.sh status                      查看当前开关状态
#
# 顺序：start → on → 重启 Typeless → 正常使用若干次 → off → 重启 Typeless → Ctrl-C 停代理。
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"
PORT="${TYPELESS_CAPTURE_PORT:-8787}"
SETTINGS="$HOME/Library/Application Support/Typeless/app-settings.json"
MITMDUMP="$ROOT/.tools/venv-mitm/bin/mitmdump"
KEY="__DEV_API_HOST"

require_settings() {
  [ -f "$SETTINGS" ] || { echo "找不到 $SETTINGS" >&2; exit 1; }
}

# Typeless 运行时会回写这个文件，带着旧值覆盖我们的修改，所以改之前必须确认它没在运行
require_app_closed() {
  if pgrep -xq Typeless; then
    echo "Typeless 正在运行。请先退出（菜单栏图标 → Quit），再执行本命令。" >&2
    exit 1
  fi
}

case "${1:-}" in
  start)
    [ -x "$MITMDUMP" ] || { echo "找不到 mitmdump：python3 -m venv .tools/venv-mitm && .tools/venv-mitm/bin/pip install 'mitmproxy==12.*'" >&2; exit 1; }
    session="_work/capture/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$session"
    decrypt=false
    [ "${2:-}" = "--decrypt-context" ] && decrypt=true
    echo "抓包目录：$PWD/${session}（解密上下文：${decrypt}）"
    exec "$MITMDUMP" \
      --mode "reverse:https://api.typeless.com" \
      --listen-host 127.0.0.1 --listen-port "$PORT" \
      --set confdir="$ROOT/.tools/mitm-conf" \
      -w "$session/flows.mitm" \
      -s tools/capture_addon.py \
      --set capture_dir="$session" \
      --set decrypt_context="$decrypt" \
      --set termlog_verbosity=info \
      --set flow_detail=1
    ;;
  on)
    require_settings
    require_app_closed
    cp "$SETTINGS" "$SETTINGS.before-capture"
    python3 -I - "$SETTINGS" "$KEY" "127.0.0.1:$PORT" <<'EOF'
import json, sys
path, key, value = sys.argv[1:4]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
data[key] = value
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent="\t")
EOF
    echo "已写入 $KEY=127.0.0.1:${PORT}（原文件备份为 app-settings.json.before-capture）。现在启动 Typeless。"
    ;;
  off)
    require_settings
    require_app_closed
    python3 -I - "$SETTINGS" "$KEY" <<'EOF'
import json, sys
path, key = sys.argv[1:3]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
removed = data.pop(key, None)
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent="\t")
print("已移除" if removed is not None else "本来就没有设置", key)
EOF
    echo "现在启动 Typeless，它会直连官方服务端。"
    ;;
  status)
    require_settings
    python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); print(sys.argv[2], "=", d.get(sys.argv[2]) or "<未设置，直连官方>")' "$SETTINGS" "$KEY"
    pgrep -xq Typeless && echo "Typeless：运行中" || echo "Typeless：未运行"
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && echo "代理端口 ${PORT}：监听中" || echo "代理端口 ${PORT}：未监听"
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 2
    ;;
esac
