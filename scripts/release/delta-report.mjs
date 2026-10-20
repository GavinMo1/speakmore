#!/usr/bin/env node
// 发版前看一眼：从下载地址上现在的最新版本升到这次打的（dist/release），每种装法要下多少。
// npm run ship 在上传前跑它。Electron 没换、却有哪种装法要下 20 MB 以上，多半是打包出了问题
// （比如每次打出来的文件都不一样，块对不上），拦下来；确实要这样发的，加 --allow-big 再跑 ship 里的这一步。
//
//   node scripts/release/delta-report.mjs              比下载地址上的
//   node scripts/release/delta-report.mjs --allow-big  超了也不拦，只报
//
// 算的是"只装着上一版的机器要下多少"：本机还装着别的几份时（比如 Mac 上终端安装和 App 都有）能拷的更多，实际只少不多。

import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { chunksIn, parseManifest } from "../../src/update/manifest.mjs";
import { unpackObject } from "../../src/update/objects.mjs";
import { DOWNLOAD_URL, parseChannel } from "../../src/update/release.mjs";
import { CHANNEL, objectPath } from "./release-layout.mjs";

const releaseDir = join(resolve(import.meta.dirname, "../.."), "dist", "release");
/** Electron 没换时一次更新最多下这么多（压过的），超了算打包有问题 */
const LIMIT_BYTES = 20 * 1024 * 1024;

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--allow-big");
if (unknown.length > 0) {
  console.error(`不认识的参数：${unknown.join(" ")}。只认 --allow-big`);
  process.exit(2);
}
const base = process.env.SPEAKMORE_INSTALL_BASE || DOWNLOAD_URL;
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`取不到 ${url}：HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const localObject = (sha) => readFileSync(join(releaseDir, objectPath(sha)));
const local = parseChannel(readFileSync(join(releaseDir, CHANNEL), "utf8"));

try {
  const liveText = await fetchBytes(`${base}/${CHANNEL}`);
  if (liveText === null) {
    console.log(`下载地址上还没有 ${CHANNEL}：这是第一次按块发布，没有可比的。`);
    process.exit(0);
  }
  const live = parseChannel(liveText.toString("utf8"));
  const sameElectron = live.electron === local.electron;
  console.log(`从 ${live.version}（Electron ${live.electron}）升到 ${local.version}（Electron ${local.electron}）：`);
  const tooBig = [];
  for (const [target, sha] of Object.entries(local.targets)) {
    const now = chunksIn(parseManifest(unpackObject(localObject(sha), sha)));
    const liveSha = live.targets[target];
    const liveManifest = liveSha ? await fetchBytes(`${base}/${objectPath(liveSha)}`) : null;
    const before = liveManifest ? chunksIn(parseManifest(unpackObject(liveManifest, liveSha))) : new Map();
    const missing = [...now.keys()].filter((chunk) => !before.has(chunk));
    // 下的是压过的对象，加上清单本身
    const bytes = [sha, ...missing].reduce((sum, chunk) => sum + statSync(join(releaseDir, objectPath(chunk))).size, 0);
    const note = liveSha ? "" : "（上一版没有这种装法，等于整个下）";
    console.log(`  ${target.padEnd(18)} 要下 ${megabytes(bytes).padStart(9)}，${missing.length} 块${note}`);
    if (sameElectron && liveSha && bytes > LIMIT_BYTES) tooBig.push(target);
  }
  if (tooBig.length > 0) {
    const message = `Electron 没换，${tooBig.join("、")} 的更新却超过 ${megabytes(LIMIT_BYTES)}：多半是打包出了问题，先查清楚`;
    if (!args.includes("--allow-big")) {
      console.error(`\n${message}。确实要这样发的，加 --allow-big 再跑这一步。`);
      process.exit(1);
    }
    console.warn(`\n${message}（加了 --allow-big，不拦）`);
  }
} catch (error) {
  console.error(`没算成：${error.message}`);
  process.exit(1);
}
