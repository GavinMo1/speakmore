#!/usr/bin/env node
// 把配置表（src/models/catalog.mjs）里的本地模型传到国内源：SpeakMore 自己的 COS 桶，前面是 CDN。
// 加了模型、换了提交之后跑一次；已经在上面、内容一样的跳过，断了再跑就接着传。
//
//   scripts/release/with-cos-key.sh npm run sync-models -- --from <本机模型仓>              传
//   scripts/release/with-cos-key.sh npm run sync-models -- --from <本机模型仓> --download   本机没有的先从原始地址下
//   npm run sync-models -- --from <本机模型仓> --dry-run                                  只列出要传什么，不联网
//
// 本机模型仓就是 App 下载模型的那种目录（一个模型一个子目录），比如 ~/.speakmore/models、bench/_work/models。
// 每个文件传之前都按配置表核对 sha256；传完从 CDN 上逐个查一遍，取不到或大小不对就报出来。
// 最后让 CDN 预热这次新传的模型文件：不预热的话，第一个下载的人要等节点回源去桶里取，慢得多。
// 已经传过、没预热过的（比如上次预热失败）用 --warm-all 把全部模型文件再预热一遍。
//
// 要的环境变量：TENCENTCLOUD_SECRET_ID、TENCENTCLOUD_SECRET_KEY，MODELS_BUCKET、COS_REGION（with-cos-key.sh 从 .machine.env 带上）

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { cdn } from "tencentcloud-sdk-nodejs-cdn";
import { CN_BASE, MODELS } from "../../src/models/catalog.mjs";
import { createModelStore } from "../../src/models/store.mjs";
import { cosStore } from "./cos.mjs";
import { modelItems, noteItems, noticeText } from "./models-layout.mjs";
import { publish } from "./release-layout.mjs";

async function sha256Of(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** 取一份文字（许可原文、原仓库的 NOTICE） */
async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`取不到 ${url}：HTTP ${response.status}`);
  return response.text();
}

/** 本机模型仓里的这个模型齐不齐、对不对；不齐的话 --download 时从原始地址下 */
async function ensureLocal(model, store, download) {
  if (!store.isInstalled(model)) {
    if (!download) throw new Error(`本机模型仓里没有装好的 ${model.id}。加 --download 从原始地址下，或者换一个 --from`);
    console.log(`下载        ${model.id}（从原始地址）`);
    await store.install(model);
  }
  for (const file of Object.values(model.files)) {
    const path = join(store.dirOf(model), file.path);
    if ((await sha256Of(path)) !== file.sha256) {
      throw new Error(`${path} 的 sha256 和配置表对不上：删掉这个模型的目录再用 --download 重下`);
    }
  }
}

/** 两份说明写进临时目录，补上 path、size、sha256 */
async function prepareNotes(model, dir) {
  const { origin, license } = model;
  const upstream = origin.notice
    ? await fetchText(`https://huggingface.co/${origin.repo}/raw/${origin.revision}/${origin.notice}`)
    : null;
  const texts = { LICENSE: await fetchText(license.url), NOTICE: noticeText(model, upstream) };
  return noteItems(model).map((item) => {
    const path = join(dir, `${model.id}-${item.name}`);
    writeFileSync(path, texts[item.name]);
    return {
      ...item,
      path,
      size: statSync(path).size,
      sha256: createHash("sha256").update(texts[item.name]).digest("hex"),
    };
  });
}

/** 传完从 CDN 上查：每个模型文件都要取得到、大小对 */
async function verifyCdn(items) {
  const problems = [];
  for (const item of items) {
    const url = `${CN_BASE}/${item.key}`;
    try {
      const response = await fetch(url, { method: "HEAD" });
      const size = Number(response.headers.get("content-length"));
      if (!response.ok) problems.push(`${url}：HTTP ${response.status}`);
      else if (size !== item.size) problems.push(`${url}：大小 ${size}，配置表里是 ${item.size}`);
      else console.log(`CDN 取得到  ${item.key}`);
    } catch (error) {
      problems.push(`${url}：${error.message}`);
    }
  }
  return problems;
}

/** 预热等多久算没成：850 MB 的文件推到大陆的节点，实测几分钟 */
const WARM_TIMEOUT_MS = 30 * 60_000;

/**
 * 让 CDN 把这些地址先拉到大陆的节点上（用的人几乎都在国内；海外的节点第一次有人取时再回源）。
 * 等到每个都有了结果；有没成的报出来
 * @returns {Promise<string[]>} 没预热成的，说清是哪个、什么状态
 */
async function warmUp(urls, { secretId, secretKey }) {
  const client = new cdn.v20180606.Client({ credential: { secretId, secretKey }, region: "" });
  const { TaskId } = await client.PushUrlsCache({ Urls: urls, Area: "mainland" });
  console.log(`预热已提交  ${urls.length} 个地址（任务 ${TaskId}）`);
  const deadline = Date.now() + WARM_TIMEOUT_MS;
  let reported = "";
  for (;;) {
    const { PushLogs = [] } = await client.DescribePushTasks({ TaskId, Limit: 100 });
    const pending = PushLogs.filter(({ Status }) => Status === "process");
    const summary = `${PushLogs.length - pending.length}/${urls.length} 有结果`;
    if (summary !== reported) console.log(`预热中      ${summary}`);
    reported = summary;
    if (PushLogs.length >= urls.length && pending.length === 0) {
      return PushLogs.filter(({ Status }) => Status !== "done").map(({ Url, Status }) => `${Url}：${Status}`);
    }
    if (Date.now() > deadline) return pending.map(({ Url }) => `${Url}：${WARM_TIMEOUT_MS / 60_000} 分钟还没预热完`);
    await new Promise((done) => setTimeout(done, 15_000));
  }
}

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    download: { type: "boolean", default: false },
    "warm-all": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!values.from) {
  console.error("要用 --from 说本机模型仓在哪，比如 --from ~/.speakmore/models");
  process.exit(2);
}
const storeDir = resolve(values.from.replace(/^~(?=\/)/, process.env.HOME));

if (values["dry-run"]) {
  for (const model of MODELS) {
    for (const item of [...modelItems(model, storeDir), ...noteItems(model)]) {
      console.log(`${item.key}  ${item.size ?? "-"} 字节  ${item.cacheControl}`);
    }
  }
  process.exit(0);
}

const notesDir = mkdtempSync(join(tmpdir(), "speakmore-model-notes-"));
try {
  const env = {
    secretId: process.env.TENCENTCLOUD_SECRET_ID,
    secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
    bucket: process.env.MODELS_BUCKET,
    region: process.env.COS_REGION,
  };
  const names = {
    secretId: "TENCENTCLOUD_SECRET_ID",
    secretKey: "TENCENTCLOUD_SECRET_KEY",
    bucket: "MODELS_BUCKET",
    region: "COS_REGION",
  };
  const missing = Object.keys(names).filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `环境变量没有设：${missing.map((key) => names[key]).join("、")}。用 scripts/release/with-cos-key.sh npm run sync-models -- --from <目录>`,
    );
  }
  if (!existsSync(storeDir) && !values.download) throw new Error(`没有 ${storeDir} 这个目录`);

  const store = createModelStore({ dir: storeDir, source: "original" });
  const cos = cosStore(env);
  // 记下这次真传了哪些：只预热它们，没变的上次已经预热过
  const uploaded = new Set();
  const recording = {
    head: cos.head,
    async put(item) {
      await cos.put(item);
      uploaded.add(item.key);
    },
  };
  const files = [];
  for (const model of MODELS) {
    await ensureLocal(model, store, values.download);
    const items = modelItems(model, storeDir);
    files.push(...items);
    await publish([...items, ...(await prepareNotes(model, notesDir))], recording, console.log);
  }
  const problems = await verifyCdn(files);
  if (problems.length > 0) {
    throw new Error(`桶里都传好了，但 CDN 上有 ${problems.length} 个取不到：\n${problems.join("\n")}`);
  }
  console.log(`\n国内源齐了：${MODELS.length} 个模型、${files.length} 个模型文件都能从 ${CN_BASE} 取到。`);

  const warm = files.filter(({ key }) => values["warm-all"] || uploaded.has(key)).map(({ key }) => `${CN_BASE}/${key}`);
  if (warm.length === 0) {
    console.log("这次没有新传的模型文件，不用预热（要全部再预热一遍加 --warm-all）。");
  } else {
    const failed = await warmUp(warm, env);
    if (failed.length > 0) {
      throw new Error(`预热有 ${failed.length} 个没成（用 --warm-all 再来一次）：\n${failed.join("\n")}`);
    }
    console.log(`预热好了：${warm.length} 个模型文件已经在大陆的节点上。`);
  }
} catch (error) {
  console.error(`没有传成：${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(notesDir, { recursive: true, force: true });
}
