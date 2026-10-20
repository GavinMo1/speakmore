#!/bin/sh
# 发一个新版本，从这台电脑发：把关 → 检查 → 打包 → 传到下载地址 → 从下载地址核对。
# 发布包只放在腾讯云 COS 一处。以前推标签由 GitHub 的机器打包再传，那边在国外，传到上海太慢，
# 0.4.0 那次传了 32 分钟一个包都没传上；本机传两个包两分多钟。
#
# 用法：改好 package.json 的版本号并提交，打同名的标签推上去，然后发：
#   git tag -a v0.4.1 -m "…" && git push origin main v0.4.1
#   npm run ship
#
# 版本号发过就不能再改（见 release-layout.mjs），所以先把关：工作区干净、HEAD 就是那个标签、标签已经推上去。
# 传到一半断了：别重新打包（打出来的包每次都不一样，会被当成改了已发布的版本），
# 直接再传一次 scripts/release/with-cos-key.sh npm run publish-release，传好的会跳过。
# 先传块，再传首次安装用的包和安装脚本，最后才换 channel.json（release-layout.mjs）：没传完的时候谁也看不到这个版本。
set -eu
cd "$(dirname "$0")/../.."

DOWNLOAD_URL="https://dl.zephyrxiang.com/speakmore"

fail() {
  echo "ship：$1" >&2
  exit 1
}

tag="v$(node -p "require('./package.json').version")"
[ -z "$(git status --porcelain)" ] || fail "工作区有没提交的改动，发出去的会和标签对不上"
git tag --points-at HEAD | grep -qx "${tag}" || fail "HEAD 上没有标签 ${tag}（package.json 里是这个版本）"
# 带注释的标签要看它指向的提交（^{}）；不带注释的没有那一行，标签指的就是提交本身
remote="$(git ls-remote origin "refs/tags/${tag}^{}" | cut -f 1)"
[ -n "${remote}" ] || remote="$(git ls-remote origin "refs/tags/${tag}" | cut -f 1)"
[ "${remote}" = "$(git rev-parse HEAD)" ] || fail "标签 ${tag} 还没推到 GitHub，或者那边指的不是这个提交"

# 安装包要签名、公证：没配的话要等打到最后才发现，先查
node --input-type=module -e 'import { signingConfig } from "./scripts/build/signing.mjs"; process.exit(signingConfig(process.cwd())?.notaryProfile ? 0 : 1)' ||
  fail "本机没配签名和公证（.machine.env 的 MAC_SIGNING_IDENTITY、MAC_NOTARY_PROFILE，见 .machine.env.example），打不了安装包"

npm run check
# 程序跑在 Electron 自带的 Node 上，单测在那个版本上也跑一遍
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test --test-timeout=5000 "test/*.test.mjs" "test/!(install)/**/*.test.mjs"
npm run release
# 和下载地址上现在的版本比，每种装法要下多少；Electron 没换却超 20 MB 的，多半是打包出了问题，拦下来
node scripts/release/delta-report.mjs ||
  fail "差量太大，没有传。查清楚再发；确实要这样发，跑 node scripts/release/delta-report.mjs --allow-big 看一遍，再接着 scripts/release/with-cos-key.sh npm run publish-release"
scripts/release/with-cos-key.sh npm run publish-release ||
  fail "没传完。别重新打包，直接再运行：scripts/release/with-cos-key.sh npm run publish-release"

# channel.json 在 CDN 上缓存一分钟，等它换过来
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  [ "$(curl -fsS "${DOWNLOAD_URL}/channel.json")" = "$(cat dist/release/channel.json)" ] && break
  sleep 10
done
[ "$(curl -fsS "${DOWNLOAD_URL}/channel.json")" = "$(cat dist/release/channel.json)" ] ||
  fail "传上去了，但下载地址上的 channel.json 两分钟后还不是这一次的"
for sum in \
  "${tag}/speakmore-darwin-arm64.tar.xz.sha256" "${tag}/SpeakMore-arm64.dmg.sha256" \
  "${tag}/speakmore-darwin-x64.tar.xz.sha256" "${tag}/SpeakMore-x64.dmg.sha256" \
  "${tag}/speakmore-win32-x64.zip.sha256" "${tag}/SpeakMore-Setup-x64.exe.sha256"; do
  [ "$(curl -fsS "${DOWNLOAD_URL}/${sum}")" = "$(cat "dist/release/${sum}")" ] || fail "下载地址上 ${sum} 和本机的不一样"
done
for script in install.sh install.ps1; do
  [ "$(curl -fsS "${DOWNLOAD_URL}/${script}" | shasum -a 256)" = "$(shasum -a 256 <"${script}")" ] ||
    fail "下载地址上的 ${script} 和仓库里的不一样（CDN 缓存一分钟，等一下再查）"
done
# 每种装法的清单从下载地址上取得到、和本机的一样（块在上传时已经逐个核对过在不在、大小对不对）
for manifest in $(node -p 'Object.values(require("./dist/release/channel.json").targets).join(" ")'); do
  [ "$(curl -fsS "${DOWNLOAD_URL}/store/${manifest}" | shasum -a 256)" = "$(shasum -a 256 <"dist/release/store/${manifest}")" ] ||
    fail "下载地址上的清单 store/${manifest} 和本机的不一样"
done
echo "发好了：${tag}。下载地址上的 channel.json、五份更新清单、Mac 两个包、两个安装包、Windows 的包和两个安装脚本都对得上。"
