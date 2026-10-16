---
name: speakmore-model-mirror
description: 本地模型的配置表只有一份（src/models/catalog.mjs）；国内源是单独的 COS 桶加 models.speakmore 子域名，传完必须预热；证书 2027-01-14 到期要续
metadata:
  type: project
---

2026-10-16 用户定的：用的人几乎都在国内，模型要能不翻墙下；原来的地址保留叫 original，另传一份到 COS 的隔离桶当国内源，用户可以选；模型会越来越多，配置要全局只有一份，不能散开（原话："要用单例模式的思维去统一管理，全部从一个 config 里面出"）。

- **配置表**：`src/models/catalog.mjs`。下载源（SOURCES：cn、original）、每个模型的文件和 sha256、许可、原作者、标签（TAGS）和实测数字（measured，出自 bench/results/）都在这里。下载、App、命令行、评测、上传脚本都读它。标签按实测打，测试会查"标了 apple-silicon 就要有在 Apple 芯片上的实测"。
- **选源**：设置项 `modelSource`（`SPEAKMORE_MODEL_SOURCE`），默认 cn。选的源先试，下不动、超了流量就换另一个，都按 sha256 校验。改了当场生效（`speakmore config set modelSource original`、App 设置里的"下载源"），正在下载的从新的源接着下。
- **国内源**：私有 COS 桶（桶名在 `.machine.env` 的 `MODELS_BUCKET`），前面是 CDN 域名 `models.speakmore.zephyrxiang.com`：全球加速，只让 CDN 读，防盗链只放行官网、localhost、127.0.0.1 和空来源，每天 50 GB 封顶（超了回 404，客户端自动改从 Hugging Face 下），强制 https。对象名是 `<模型 id>/<原始提交>/<文件>`，每个模型目录里带 LICENSE 和 NOTICE（FunASR 许可要求注明来源作者，Apache-2.0 要求附原文）。
- **加模型或换提交**：改配置表，然后 `scripts/release/with-cos-key.sh npm run sync-models -- --from <本机模型仓> [--download]`。脚本会上传、从 CDN 核对，再预热这次新传的文件（只推大陆节点）。
- **传完必须预热**（2026-10-16 用户说的："之后记得预热就好"）。实测：CDN 刚上线、没预热时，本机第一次从国内源下 253 MB，用了 75 秒，约 3.3 MB/s；同一台机器从 Hugging Face 下只有 0.6–1 MB/s。用户据此认为 COS 加速有效。预热失败用 `--warm-all` 重来。
- **证书要续**：`models.speakmore.zephyrxiang.com` 也是 90 天的免费证书，2027-01-14 到期。和 dl、media 那两张一样，到期前重新申请并在 CDN 上换绑。

**Why:** 国内用户直连 Hugging Face 很慢（这台机器 850 MB 下了 24 分钟）；模型一多，散在各处的地址和标签会对不上。
**How to apply:** 模型的任何信息只加在配置表里。云上的证书、CDN、解析改动按 [[cloud-changes-user-runs]] 交给用户跑。相关：[[speakmore-release-on-cos]]、[[speakmore-model-plaza]]、[[speakmore-two-pipelines]]。
