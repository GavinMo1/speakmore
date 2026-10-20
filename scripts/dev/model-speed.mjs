#!/usr/bin/env node
// 量本机模型的几个下载源有多快：默认那个模型最大的文件（约 850 MB），每个源各下两次、每次最多 40 秒，取平均。
// README 和官网的下载速度对比图（website/scripts/readme-media.mjs 的 SPEED）照这里量出来的填。
//
//   node scripts/dev/model-speed.mjs            量魔搭、hf-mirror、Hugging Face
//   node scripts/dev/model-speed.mjs --seconds 20 --rounds 3
//
// 要关掉代理再量：开着代理的虚拟网卡时，域名都解析成 198.18 开头的假地址，量的是代理的速度。脚本发现了就不量。

import { spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { parseArgs } from "node:util";
import { DEFAULT_TRANSCRIBER, downloadUrls, MODELS } from "../../src/models/catalog.mjs";

const { values: args } = parseArgs({
  options: {
    seconds: { type: "string", default: "40" },
    rounds: { type: "string", default: "2" },
  },
});
const seconds = Math.max(5, Number(args.seconds) || 40);
const rounds = Math.max(1, Number(args.rounds) || 2);

const model = MODELS.find((m) => m.id === DEFAULT_TRANSCRIBER);
const file = Object.values(model.files).sort((a, b) => b.size - a.size)[0];
// 地址照 App 下载时用的（catalog.mjs 的 downloadUrls），换了源这里跟着换
const NAMES = { "modelscope.cn": "魔搭", "huggingface.co": "Hugging Face" };
const SOURCES = downloadUrls(model, file).map((url) => [NAMES[new URL(url).hostname] ?? new URL(url).hostname, url]);

// 198.18.0.0/15 是留给测试的地址段，代理软件的虚拟网卡（TUN）拿它当假地址
const proxied = [];
for (const [, url] of SOURCES) {
  const host = new URL(url).hostname;
  const { address } = await lookup(host);
  if (/^198\.(18|19)\./.test(address)) proxied.push(`${host} → ${address}`);
}
if (proxied.length > 0) {
  console.error(`代理还开着（${proxied.join("、")}），量出来的是代理的速度。关掉代理（连虚拟网卡）再跑。`);
  process.exit(1);
}

console.log(
  `${model.id} 的 ${file.path}（${(file.size / 1e6).toFixed(0)} MB），每个源 ${rounds} 次、每次最多 ${seconds} 秒\n`,
);
const results = [];
for (const [name, url] of SOURCES) {
  const speeds = [];
  for (let round = 1; round <= rounds; round += 1) {
    // 下到时间到就停（curl 退出码 28），按已经下到的算速度；没跟着跳转、不是 200 的算没下成
    const run = spawnSync(
      "curl",
      [
        "-sL",
        "-o",
        "/dev/null",
        "--max-time",
        String(seconds),
        "-w",
        "%{http_code} %{speed_download} %{size_download}",
        url,
      ],
      { encoding: "utf8" },
    );
    const [code, speed, size] = run.stdout.trim().split(" ");
    const ok = (code === "200" || code === "206") && Number(size) > 0;
    const mbps = ok ? Number(speed) / 1e6 : 0;
    speeds.push(mbps);
    console.log(
      `  ${name.padEnd(14)} 第 ${round} 次：${ok ? `${mbps.toFixed(2)} MB/s（${(Number(size) / 1e6).toFixed(0)} MB）` : `没下成（HTTP ${code}，curl 退出码 ${run.status}）`}`,
    );
  }
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  results.push({ name, url, speeds, mean });
}
console.log("\n平均（MB/s，十进制）：");
for (const { name, mean } of results) {
  const minutes = mean > 0 ? (file.size / 1e6 / mean / 60).toFixed(1) : "-";
  console.log(
    `  ${name.padEnd(14)} ${mean.toFixed(2).padStart(6)}   下完 ${(file.size / 1e6).toFixed(0)} MB 约 ${minutes} 分钟`,
  );
}
console.log(`\n${JSON.stringify({ measuredAt: new Date().toISOString(), seconds, rounds, results })}`);
