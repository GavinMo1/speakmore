---
name: speakmore-release-on-cos
description: SpeakMore 的发布包在腾讯云 COS + CDN（dl.zephyrxiang.com/speakmore/），只从本机用 npm run ship 发，GitHub 上的发布流程已删；证书 2027-01-12 到期要续
metadata:
  type: project
---

SpeakMore 的发布包放在用户自己的腾讯云 COS，前面是 CDN 域名 `dl.zephyrxiang.com`，东西都在 `speakmore/` 前缀下。2026-10-13 他定的：不用 GitHub Release（太慢），新建专用的桶，下载地址用 zephyrxiang.com 的子域名，以后官网的下载链接也从这里取。

**Why:** 他要一行命令装得快；GitHub Release 在国内下 130 多兆的包太慢。

**How to apply:**

- 发新版本只从本机发（2026-10-13 他定的："压缩包都在腾讯云上了为啥还要在 github 上弄一份，留一端就好了"）：改 `package.json` 的版本号并提交，打同名的 `v` 开头标签推上去，然后 `npm run ship`（`scripts/release/ship.sh`）。它先把关（工作区干净、HEAD 就是那个标签、标签已推上去），再跑全部检查（含 Electron 自带 Node 上的单测）、打包、上传、从下载地址核对版本号和校验值。合并、推标签前都先问他。
- 为什么不用 CI 发：GitHub 的机器在国外，往上海的桶传太慢。0.3.0 传了 28 分半；0.4.0 传了 32 分钟第一个包还没传完，COS 回 "User network is too slow"。本机传两个包 2 分 15 秒。`.github/workflows/release.yml` 已删。
- 传到一半断了：别重新打包（每次打出来的包字节不同，会被当成改了已发布的版本而拒绝），直接再跑 `scripts/release/with-cos-key.sh npm run publish-release`，传好的会跳过。失败的上传会在桶里留没传完的分片，用本机密钥 `multipartList` / `multipartAbort` 清掉（0.4.0 那个已清）。
- 发布过的版本号不覆盖（`scripts/release/release-layout.mjs` 会拒绝）：CDN 和用户手里缓存的都是旧内容，要改就升版本号。要在本机试链路，用预发版本号（比如 `v0.2.1-rc.1`），或者 `SPEAKMORE_INSTALL_BASE=$PWD/dist/release` 装本机打的包。
- 桶名、地域、凭据名、加载器都在不进 git 的 `.machine.env`（`COS_BUCKET`、`COS_REGION`、`COS_CREDENTIAL`、`COS_SECRETS_LOADER`），仓库里只认变量名（[[machine-facts-stay-local]]）。腾讯云这把凭据和 Gemini 那把不在同一个加载器下，所以有单独的 `COS_SECRETS_LOADER`；找不到时先看 `.machine.env`，不要满机器搜。
- 以前 CI 用的子账号密钥（腾讯云子账号 `speakmore-ci`、策略 `speakmore-release-upload`，存在仓库 Actions secrets 里）已在 2026-10-14 照他的话全部删掉：四个 secrets、子账号连同密钥、策略都没了。以后要在 GitHub 上发布得重新签一把，但他定了只从本机发。
- 云上的配置照他另一个产品域名的样子配的：桶私有、只让 CDN 读，CDN 全球加速、跟随源站的缓存头、每天 50 GB 流量封顶（超了返回 404）。运维走命令行，方法见 `zephyr-cloud-cli-ops`。
- **证书要续**：`dl.zephyrxiang.com` 用的是 90 天的免费证书，2027-01-12 到期。到期前重新申请一张（DNS 自动验证）并在 CDN 上换绑；不换的话安装命令会因为证书过期全部失败。
