#!/bin/sh
# 发完版在 Mac 上验收线上的包：下载 Apple 芯片的 dmg、核对校验值和公证，挂载后用隔离的家目录真启动一次；
# 再照 README 终端安装那一行装进临时目录，update 应说已是最新。真的家目录、/Applications、~/.local/bin 都不碰。
#
#   scripts/release/accept-mac.sh            验 package.json 里的版本
#   scripts/release/accept-mac.sh 0.17.1     验指定的版本
set -u
cd "$(dirname "$0")/../.."

V="${1:-$(node -p "require('./package.json').version")}"
B="https://dl.zephyrxiang.com/speakmore"
# 放在 /tmp 下：会话临时目录的路径太长，拼上 run/ 里的控制套接字会超过 103 字节，App 照设计报错退出
D=$(mktemp -d /tmp/smv.XXXX)
echo "验 ${V}，临时目录 $D"
mkdir -p "$D/dl" "$D/cf" "$D/home"

echo "== 1. 下载 dmg、核对校验值"
(cd "$D/dl" && curl -fsSLO "$B/v$V/SpeakMore-arm64.dmg" && curl -fsSLO "$B/v$V/SpeakMore-arm64.dmg.sha256") || { echo "下载失败"; rm -rf "$D"; exit 1; }
want=$(awk '{print $1}' "$D/dl/SpeakMore-arm64.dmg.sha256")
got=$(shasum -a 256 "$D/dl/SpeakMore-arm64.dmg" | awk '{print $1}')
[ "$want" = "$got" ] && echo "校验值对得上 $got" || echo "校验值不对：要 $want 得 $got"
spctl -a -vv -t open --context context:primary-signature "$D/dl/SpeakMore-arm64.dmg" 2>&1

echo "== 2. 挂载、看 App 的版本和公证"
hdiutil attach -nobrowse -readonly -mountpoint "$D/mnt" "$D/dl/SpeakMore-arm64.dmg" >/dev/null || { echo "挂载失败"; rm -rf "$D"; exit 1; }
APP="$D/mnt/SpeakMore.app"
echo "App 版本 $(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString)"
spctl -a -vv "$APP" 2>&1

echo "== 3. 隔离家目录真启动"
# SPEAKMORE_APP、SPEAKMORE_BIN_DIR 钉住：不钉的话会去找 /Applications 里真的那个 App、改指 ~/.local/bin 的链接；
# CFFIXED_USER_HOME 换掉：偏好设置不写进真的家目录
SPEAKMORE_HOME="$D/home" SPEAKMORE_APP="$APP" SPEAKMORE_BIN_DIR="$D/bin" CFFIXED_USER_HOME="$D/cf" \
  "$APP/Contents/MacOS/SpeakMore" >"$D/app.out" 2>&1 &
pid=$!
log="$D/home/logs/main.log"
i=0
until grep -q helper_ready "$log" 2>/dev/null || [ $i -ge 60 ]; do sleep 1; i=$((i + 1)); done
grep -oE '"(msg|event)":"(started|helper_ready)"[^}]{0,80}' "$log" 2>/dev/null | head -4
echo "日志里的 error：$(grep -c '"level":"error"' "$log" 2>/dev/null || true) 条"
grep '"level":"error"' "$log" 2>/dev/null | head -3
kill "$pid" 2>/dev/null; sleep 3; pkill -f "$D/mnt/SpeakMore.app" 2>/dev/null; sleep 1
# 执行过的 App 会登记进 LaunchServices，卸载前注销
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$APP" 2>/dev/null
hdiutil detach "$D/mnt" >/dev/null 2>&1 || hdiutil detach -force "$D/mnt" >/dev/null 2>&1
echo "已退出、注销、卸载"

echo "== 4. 终端安装进临时目录，再 update"
# 不指定版本：照 README 那一行装最新的，装出来应该就是 ${V}（channel.json 换过来了）
SPEAKMORE_HOME="$D/h2" SPEAKMORE_BIN_DIR="$D/bin2" SPEAKMORE_APP="$D/noapp/SpeakMore.app" \
  sh -c "curl -fsSL $B/install.sh | sh" </dev/null 2>&1 | tail -6
SPEAKMORE_HOME="$D/h2" SPEAKMORE_APP="$D/noapp/SpeakMore.app" "$D/bin2/speakmore" --version 2>&1 | tail -1
SPEAKMORE_HOME="$D/h2" SPEAKMORE_BIN_DIR="$D/bin2" SPEAKMORE_APP="$D/noapp/SpeakMore.app" "$D/bin2/speakmore" update 2>&1 | tail -3

rm -rf "$D"
echo "== 完，临时目录已删"
