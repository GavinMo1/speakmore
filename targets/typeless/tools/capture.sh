#!/bin/bash
# Typeless 抓包的开关脚本。原理见 capture_addon.py 顶部说明。
#
#   tools/capture.sh start [--decrypt-context]   起本机转发代理（前台运行，Ctrl-C 结束）
#   tools/capture.sh on                          让 Typeless 改连本机代理（改 app-settings.json，需重启 Typeless）
#   tools/capture.sh off                         恢复直连官方服务端（需重启 Typeless）
#   tools/capture.sh status                      查看当前开关状态
#   tools/capture.sh har <抓包目录>              导出隐去凭据的 HAR，交给 REA inspect_web_network_capture
#
# 顺序：start → on → 重启 Typeless → 正常使用若干次 → off → 重启 Typeless → Ctrl-C 停代理 → har。
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
    rm -f "$SETTINGS.before-capture"
    echo "现在启动 Typeless，它会直连官方服务端。"
    ;;
  status)
    require_settings
    python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); print(sys.argv[2], "=", d.get(sys.argv[2]) or "<未设置，直连官方>")' "$SETTINGS" "$KEY"
    pgrep -xq Typeless && echo "Typeless：运行中" || echo "Typeless：未运行"
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && echo "代理端口 ${PORT}：监听中" || echo "代理端口 ${PORT}：未监听"
    ;;
  har)
    # REA 读 mitmproxy 原生格式需要 Linux，HAR 不需要，所以先转一道
    session="${2:-}"
    [ -f "$session/flows.mitm" ] || { echo "用法：tools/capture.sh har <含 flows.mitm 的抓包目录>" >&2; exit 2; }
    "$MITMDUMP" -q -n -r "$session/flows.mitm" --set confdir="$ROOT/.tools/mitm-conf" --set hardump="$session/raw.har"
    python3 -I - "$session/raw.har" "$session/capture.har" <<'EOF'
import json, re, sys
src, dst = sys.argv[1:3]
SENSITIVE = {"authorization", "x-authorization", "cookie", "set-cookie"}
with open(src, encoding="utf-8") as f:
    har = json.load(f)
replaced = 0
for entry in har["log"]["entries"]:
    for side in ("request", "response"):
        for header in entry[side].get("headers", []):
            if header["name"].lower() in SENSITIVE:
                header["value"] = f"<redacted {len(header['value'])}>"
                replaced += 1
        entry[side]["cookies"] = []
    request = entry["request"]
    # WebSocket 握手把令牌和签名放在查询参数 t 里
    for query in request.get("queryString", []):
        if query["name"] == "t":
            query["value"] = f"<redacted {len(query['value'])}>"
            replaced += 1
    request["url"] = re.sub(r"([?&]t=)[^&]+", r"\1REDACTED", request["url"])
with open(dst, "w", encoding="utf-8") as f:
    json.dump(har, f, ensure_ascii=False)
print(f"条目 {len(har['log']['entries'])}，已替换凭据字段 {replaced} 处 → {dst}")
EOF
    echo "raw.har 含完整凭据，只留本机；交给 REA 的是 capture.har。"
    ;;
  *)
    sed -n '2,11p' "$0"
    exit 2
    ;;
esac
