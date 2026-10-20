#!/usr/bin/env node
// 下载地址（dl.zephyrxiang.com）的用量封顶：按小时累计流量，超了全部返回 404，到下一个小时自动恢复。
//
//   scripts/release/with-cos-key.sh node scripts/ops/cdn-cap.mjs            只看：现在的配置和要改成的样子
//   scripts/release/with-cos-key.sh node scripts/ops/cdn-cap.mjs --apply    改
//   … --apply --gb 6                                                        换一个每小时的上限
//
// 为什么按小时：以前每天 50 GB，被刷到顶就整天 404，真用户一天都装不上。更新改成按块下以后，
// 正常一小时的量很小（首次安装一个包约 100 MB，更新几 MB），每小时 4 GB 够四十来个人同时装。
// 被刷时每小时最多 4 GB，一天最多约 96 GB，按境内 0.21 元/GB 约 20 元；真用户最多等到下一个小时。
// 境内、境外各算各的（腾讯云的封顶按区域分别触发）。

import { parseArgs } from "node:util";
import { cdn } from "tencentcloud-sdk-nodejs-cdn";

const DOMAIN = "dl.zephyrxiang.com";

const { values: args } = parseArgs({ options: { apply: { type: "boolean" }, gb: { type: "string", default: "4" } } });
const gb = Number(args.gb);
if (!(gb > 0)) {
  console.error(`--gb 要是正数，收到的是 ${args.gb}`);
  process.exit(2);
}
const secretId = process.env.TENCENTCLOUD_SECRET_ID;
const secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
if (!secretId || !secretKey) {
  console.error("环境里没有腾讯云密钥：用 scripts/release/with-cos-key.sh node scripts/ops/cdn-cap.mjs 跑");
  process.exit(2);
}

/** 和控制台一样按 1024 算：填 4 GB 就是 4 × 1024³ 字节 */
const threshold = Math.round(gb * 2 ** 30);
const item = {
  Type: "total",
  Switch: "on",
  Metric: "flux",
  // 统计周期和自动解封都是分钟
  Cycle: 60,
  UnBlockTime: 60,
  BpsThreshold: threshold,
  CounterMeasure: "RETURN_404",
  AlertSwitch: "on",
  AlertPercentage: 80,
};
const wanted = {
  Switch: "on",
  Metric: "flux",
  BpsThreshold: threshold,
  CounterMeasure: "RETURN_404",
  AlertSwitch: "on",
  AlertPercentage: 80,
  StatisticItems: [item],
};

const client = new cdn.v20180606.Client({ credential: { secretId, secretKey }, region: "" });
const describe = async () => {
  const { Domains } = await client.DescribeDomainsConfig({ Filters: [{ Name: "domain", Value: [DOMAIN] }], Limit: 1 });
  if (!Domains?.length) throw new Error(`账号里没有 ${DOMAIN}`);
  return Domains[0].BandwidthAlert;
};
const summary = (alert) => {
  const items = alert?.StatisticItems ?? [];
  if (alert?.Switch !== "on" || items.length === 0) return "没开封顶";
  return items
    .map(
      (it) =>
        `${it.Type} ${it.Metric} 每 ${it.Cycle} 分钟 ${(it.BpsThreshold / 2 ** 30).toFixed(1)} GB，超了 ${it.CounterMeasure}，` +
        `${it.UnBlockTime} 分钟后解封，${it.AlertSwitch === "on" ? `到 ${it.AlertPercentage}% 提醒` : "不提醒"}（${it.Switch}）`,
    )
    .join("；");
};

try {
  console.log(`${DOMAIN} 现在：${summary(await describe())}`);
  console.log(`要改成：${summary(wanted)}`);
  if (!args.apply) {
    console.log("\n只看了一眼，没改。确认后加 --apply 再跑。");
    process.exit(0);
  }
  await client.UpdateDomainConfig({ Domain: DOMAIN, BandwidthAlert: wanted });
  // 配置下发要一两分钟，读回来核对写进去的是不是这样
  const now = await describe();
  const applied = now?.StatisticItems?.find((it) => it.Type === "total");
  const ok = applied && applied.Cycle === 60 && applied.UnBlockTime === 60 && applied.BpsThreshold === threshold;
  console.log(`\n改完读回来：${summary(now)}`);
  if (!ok) throw new Error("读回来的和要改的不一样，去控制台看一眼（CDN › 域名管理 › 访问控制 › 用量封顶）");
  console.log("改好了。");
} catch (error) {
  console.error(`没改成：${error.message}`);
  process.exit(1);
}
