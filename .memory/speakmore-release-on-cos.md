---
name: speakmore-release-on-cos
description: SpeakMore 的发布包在腾讯云 COS + CDN（dl.zephyrxiang.com/speakmore/），推版本标签由 CI 发；证书 2027-01-12 到期要续
metadata:
  type: project
---

SpeakMore 的发布包放在用户自己的腾讯云 COS，前面是 CDN 域名 `dl.zephyrxiang.com`，东西都在 `speakmore/` 前缀下。2026-10-13 他定的：不用 GitHub Release（太慢），新建专用的桶，下载地址用 zephyrxiang.com 的子域名，以后官网的下载链接也从这里取。

**Why:** 他要一行命令装得快；GitHub Release 在国内下 130 多兆的包太慢。

**How to apply:**

- 发新版本：改 `package.json` 的版本号，推同名的 `v` 开头标签，`.github/workflows/release.yml` 会检查、打包、上传。本机发用 `scripts/with-cos-key.sh npm run publish-release`。推标签前先问他。
- 发布过的版本号不覆盖（`scripts/release-layout.mjs` 会拒绝）：CDN 和用户手里缓存的都是旧内容，要改就升版本号。所以正式版本号只由一条路发一次；要在本机试链路，用预发版本号（比如 `v0.2.1-rc.1`）。
- 桶名、地域、凭据名、加载器都在不进 git 的 `.machine.env`（`COS_BUCKET`、`COS_REGION`、`COS_CREDENTIAL`、`COS_SECRETS_LOADER`），仓库里只认变量名（[[machine-facts-stay-local]]）。腾讯云这把凭据和 Gemini 那把不在同一个加载器下，所以有单独的 `COS_SECRETS_LOADER`；找不到时先看 `.machine.env`，不要满机器搜。
- CI 用的是另一把子账号密钥，只能往发布桶里传文件（不能列、不能删、碰不到别的桶），只存在仓库的 Actions secrets 里，本机没有副本。丢了或要换，用主账号再签一把重新放进去。
- 云上的配置照他另一个产品域名的样子配的：桶私有、只让 CDN 读，CDN 全球加速、跟随源站的缓存头、每天 50 GB 流量封顶（超了返回 404）。运维走命令行，方法见 `zephyr-cloud-cli-ops`。
- **证书要续**：`dl.zephyrxiang.com` 用的是 90 天的免费证书，2027-01-12 到期。到期前重新申请一张（DNS 自动验证）并在 CDN 上换绑；不换的话安装命令会因为证书过期全部失败。
