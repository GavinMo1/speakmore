---
name: speakmore-release-on-cos
description: SpeakMore 的发布包在腾讯云 COS + CDN（dl.zephyrxiang.com/speakmore/），只从本机用 npm run ship 发，GitHub 上的发布流程已删；证书 2027-01-12 到期要续
metadata:
  node_type: memory
  type: project
  originSessionId: 01cb214e-9235-4c39-87a1-f99a7f88b66e
  modified: 2026-10-19T06:40:00.000Z
---

SpeakMore 的发布包放在用户自己的腾讯云 COS，前面是 CDN 域名 `dl.zephyrxiang.com`，东西都在 `speakmore/` 前缀下。2026-10-13 他定的：不用 GitHub Release（太慢），新建专用的桶，下载地址用 zephyrxiang.com 的子域名，以后官网的下载链接也从这里取。

**Why:** 他要一行命令装得快；GitHub Release 在国内下 130 多兆的包太慢。

**How to apply:**

- 发新版本只从本机发（2026-10-13 他定的："压缩包都在腾讯云上了为啥还要在 github 上弄一份，留一端就好了"）：改 `package.json` 的版本号并提交，打同名的 `v` 开头标签推上去，然后 `npm run ship`（`scripts/release/ship.sh`）。它先把关（工作区干净、HEAD 就是那个标签、标签已推上去），再跑全部检查（含 Electron 自带 Node 上的单测）、打包、上传、从下载地址核对版本号和校验值。合并、推标签前都先问他。
- 为什么不用 CI 发：GitHub 的机器在国外，往上海的桶传太慢。0.3.0 传了 28 分半；0.4.0 传了 32 分钟第一个包还没传完，COS 回 "User network is too slow"。本机传两个包 2 分 15 秒。`.github/workflows/release.yml` 已删。
- 传到一半断了：别重新打包（每次打出来的包字节不同，会被当成改了已发布的版本而拒绝），直接再跑 `scripts/release/with-cos-key.sh npm run publish-release`，传好的会跳过。失败的上传会在桶里留没传完的分片，用本机密钥 `multipartList` / `multipartAbort` 清掉（0.4.0 那个已清）。
- 0.6.0 起命令行装的用 `speakmore update` 升级：它读下载地址根上的 `latest`，比自己新就下载根上的 `install.sh`、钉住那个版本号去装；`speakmore status` 一天最多查一次 `latest`，有新版本时提醒一句。所以根上的 `install.sh` 和 `latest` 要一直在、一直是最新的（ship 会传）。从 0.5.0 及更早的升上来，还得再跑一次安装那一行（那些版本里没有 update）。0.6.2 起 update 连 SpeakMore.app 一起换（下载对应芯片的 dmg、验校验值和签名的开发者；App 正在跑就先退出、换完重新打开），所以根上各版本目录里的 dmg 和 .sha256 也要一直在。从 0.6.1 及更早升上来的那一次还是旧逻辑：只换命令行那一份、停掉 App 改启命令行那一份，用 App 的人那一次要手动换 App。
- 发布过的版本号不覆盖（`scripts/release/release-layout.mjs` 会拒绝）：CDN 和用户手里缓存的都是旧内容，要改就升版本号。要在本机试链路，用预发版本号（比如 `v0.2.1-rc.1`），或者 `SPEAKMORE_INSTALL_BASE=$PWD/dist/release` 装本机打的包。
- 不发版就想先在自己电脑上用（2026-10-16 试 0.7.1 时这么做的）：临时把版本号改成 `0.7.1-dev.N`，`MAC_NOTARY_PROFILE=` 跳过公证打包，再用 `SPEAKMORE_INSTALL_BASE` 装上，装完把 package.json 改回去。跳过公证会被自动模式拦下，要写成脚本交给用户跑（[[cloud-changes-user-runs]]）。之后正式版用 `speakmore update` 就能盖过去，key、权限、历史都还在。
- 发版记录：0.7.1 在 2026-10-16 发布（ship 一次跑通，10 个文件），官网同一天重新部署，用户电脑从 0.7.1-dev.2 用 update 升上来，App 是公证过的。0.8.0 在 2026-10-17 发布（模型广场、数据隐私模式、首页选识别方式、推荐组合；ship 一次跑通，10 个文件），官网同一天重新部署，线上包里的版本号是 0.8.0。0.9.0 在 2026-10-17 发布（Windows 版：安装程序 SpeakMore-Setup-x64.exe 和 zip，首次引导重做，悬浮条提示可关；ship 挂后台一次跑通，15 个文件），官网同一天部署（线上提交 c151704），Windows 的下载按钮放了正式版。0.9.1 在 2026-10-17 发布（修刚装好时切不出原生识别的死锁：识别方式选了就当场换上；ship 挂后台一次跑通，15 个文件），官网同一天部署（线上提交 691a833），两个下载地址都回 200。0.9.2 在 2026-10-17 发布（修 0.9.0、0.9.1 的 Mac 版 App 一启动就报找不到模块，issue #4；第一次 ship 在 Electron 的 Node 上撞到 tail 测试的竞态没发出去，修好后重跑一次跑通，15 个文件），发完下载线上的 Apple 芯片 dmg、挂载后用隔离的 SPEAKMORE_HOME 真启动一次（started 0.9.2、helper_ready、零报错）再算发好（[[acceptance-end-to-end]]）。官网同一天部署（线上提交 3b53daa）；这次部署先撞上脚本的毛病：重做时传的路径加了 docs/、src/，服务器端换代码只删原来四样，第二次部署 mv 撞目录停在构建前，已改成按传来的顶层条目删。
- 0.9.3 在 2026-10-18 发布（Windows 安装按版本放进 versions\，杀毒软件扫着刚解出来的文件也装得上，issue #5；ship 由他挂后台一次跑通，15 个文件）。Windows 包打好就在开发机上跑了十个端到端场景，Apple 芯片 dmg 公证完挂载真启动（started 0.9.3、helper_ready、零报错），传完又从线上地址在 Windows 上装了一遍（irm 那一行和安装程序都起来了）。官网同一天部署（线上提交 3269059），issue #5 回复后关闭。
- 0.9.4 在 2026-10-19 发布（自定义服务可以填额外请求参数 customParams，检测请求不再带 max_tokens，issue #8；15 个文件）。ship 由用户挂后台，Intel 安装包提交公证时连苹果超时（HTTPClientError.connectTimeout）退出，那时什么都还没传。没有重跑 ship，照 `scripts/build/dmg.mjs` 的步骤只补那个 dmg 的公证、钉票据、核对、写 .sha256，再补 release.mjs 最后的 install.sh、install.ps1、latest，然后 `publish-release -- --dry-run` 查齐、`publish-release` 上传、照 ship.sh 核对下载地址，写成自己挂后台的脚本交给用户跑。Windows zip 打好就在开发机上用隔离家目录真启动过，线上 Apple 芯片 dmg 公证完挂载跑了端到端。官网同一天部署（线上提交 7a8a6ac），issue #8 回复后关闭。
- 公证连苹果超时：不要整个重跑 ship。重打会让已验过的包作废、多花十几分钟，照上一条只补没过的那一步。0.9.4 之后 `scripts/build/dmg.mjs` 的公证没拿到苹果结论时隔 30 秒重交、最多三次；应用本身那次公证走 @electron/packager 的 osxNotarize，不重试，断在那里就整个重跑 ship（那时还什么都没传）。
- 桶名、地域、凭据名、加载器都在不进 git 的 `.machine.env`（`COS_BUCKET`、`COS_REGION`、`COS_CREDENTIAL`、`COS_SECRETS_LOADER`），仓库里只认变量名（[[machine-facts-stay-local]]）。腾讯云这把凭据和 Gemini 那把不在同一个加载器下，所以有单独的 `COS_SECRETS_LOADER`；找不到时先看 `.machine.env`，不要满机器搜。
- 以前 CI 用的子账号密钥（腾讯云子账号 `speakmore-ci`、策略 `speakmore-release-upload`，存在仓库 Actions secrets 里）已在 2026-10-14 照他的话全部删掉：四个 secrets、子账号连同密钥、策略都没了。以后要在 GitHub 上发布得重新签一把，但他定了只从本机发。
- 云上的配置照他另一个产品域名的样子配的：桶私有、只让 CDN 读，CDN 全球加速、跟随源站的缓存头、每天 50 GB 流量封顶（超了返回 404）。运维走命令行，方法见 `zephyr-cloud-cli-ops`。
- **证书要续**：`dl.zephyrxiang.com` 用的是 90 天的免费证书，2027-01-12 到期。到期前重新申请一张（DNS 自动验证）并在 CDN 上换绑；不换的话安装命令会因为证书过期全部失败。
