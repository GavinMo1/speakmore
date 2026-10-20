---
name: speakmore-cloud-billing
description: 腾讯云按量付费、不能欠费，余额花完 CDN 两小时后下线、下载全断；10-19 余额 137 元，告警设在 50 元
metadata:
  node_type: memory
  type: project
  originSessionId: 6b5e9ce5-00ff-48cc-99ba-a927306fc7c3
  modified: 2026-10-19T12:34:40.372Z
---

发布包、官网的图走同一个腾讯云账号的 CDN 和 COS（本机模型老的国内源 10-20 已撤，模型改从魔搭下、不花他的流量）。2026-10-19 用接口只读查到的情况：

- **计费方式：** CDN 按流量计费，每小时结一次；账号里没有有效的流量包（两个 2024 年就过期了）。中国境内 0.21 元/GB，境外 0.31 到 0.63 元/GB。回源流量由 COS 收，参考价约 0.15 元/GB，未确认是不是现价。
- **不能欠费：** 余额变负后 CDN 只有 2 小时缓冲，之后所有加速域名下线，安装包、模型、官网的图都下载不了；充值后可能要去控制台手动重新上线域名。
- **10-19 的情况：** 本月到当天共 44.39 元（CDN 37.40、COS 7.07），当天约 14 元。余额原本只剩 37.6 元，他充了 100 元（到账后 137.52 元），并设了 50 元的余额告警。流量包他说先不买，看之后的趋势。
- **10-20 的情况：** 余额 125.78 元，本月 64.14 元（CDN 54.28、COS 9.94）。流量大头是老的模型域名，10-19 一天 49 GB、离每天 50 GB 的封顶只差一点。
- **流量上限也是费用上限：** 按天封顶时三个域名境内、境外全打满，一天最多约 60 到 90 元，大头是境外流量。发布包的域名 10-20 起是每小时 4 GB（`scripts/ops/cdn-cap.mjs`），被刷时一天最多约 96 GB、境内约 20 元。本机模型 10-20 起走魔搭，不花他的流量；老的模型域名等新版发完、验过后撤掉。要调高上限，先看余额够不够。

**Why:** 下载量涨起来以后，余额花完会让所有下载突然中断。这比流量上限更急，第一次查的时候他并不知道。
**How to apply:** 他查下载量、提到费用或者要调上限时，顺带查一下余额和本月花费。查法是只读接口：用 tencentcloud-sdk-nodejs-billing 调 DescribeAccountBalance、DescribeBillSummaryByProduct，CDN 的 DescribePayType，经 `scripts/release/with-cos-key.sh` 带密钥跑。充值、买流量包、改告警都由他在控制台做。相关：[[speakmore-download-stats]]、[[speakmore-release-on-cos]]、[[cloud-changes-user-runs]]。
