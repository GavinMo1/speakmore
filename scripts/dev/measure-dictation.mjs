#!/usr/bin/env node

// 量一次"典型的口述"要用多少：拿评测语料里的真实录音（bench/_work/datasets/default，bench/prepare.mjs 洗出来的），
// 走产品里真的那几层，记下每次调用报的用量，取平均。模型页推荐组合的月成本按它算（src/usage/estimate.mjs 的 TYPICAL）。
//   润色  每条录音用本机 Qwen3-ASR 0.6B Q8 转好的原文（评测结果库里有，不重转），交给 --polish 列的每一家
//   原生  录音直接交给 --native 列的每一家，思考档位照 App 的默认
// 只打印数字（时长、token 的平均），不打印原文和成品：那是用户说的话。
//
// 用法（几家的 key 各套一层 with-key）：
//   scripts/dev/with-key.sh deepseek scripts/dev/with-key.sh gemini \
//     node scripts/dev/measure-dictation.mjs --polish deepseek/deepseek-flash --native gemini/gemini-3.6-flash [--limit 20]

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { parseChatChoice } from "../../src/server/chat/vendors.mjs";
import { DEFAULT_THINKING_LEVEL, parseModelChoice } from "../../src/server/providers/index.mjs";
import { createChatPolisher } from "../../src/server/refine/polisher.mjs";
import { createModelRefiner } from "../../src/server/refine/refiner.mjs";
import { findVendor } from "../../src/server/vendors.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const DATASET = join(ROOT, "bench/_work/datasets/default");
const TRANSCRIBED_BY = "qwen3-asr-0.6b-q8";
const QUIET = { info() {}, warn() {}, error() {} };

const { values } = parseArgs({
  options: {
    polish: { type: "string", default: "" },
    native: { type: "string", default: "" },
    limit: { type: "string" },
  },
});
const list = (text) => text.split(",").filter(Boolean);

function keyOf(id) {
  const { keyEnv } = findVendor(id);
  const key = process.env[keyEnv]?.trim();
  if (!key) throw new Error(`缺少环境变量 ${keyEnv}（用 scripts/dev/with-key.sh ${id} 套上）`);
  return key;
}

const clips = readFileSync(join(DATASET, "manifest.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
  .slice(0, values.limit ? Number(values.limit) : undefined);

const db = new DatabaseSync(join(ROOT, "bench/_work/results.db"), { readOnly: true });
const transcriptOf = (clip) => {
  const row = db
    .prepare("select output from results where stage = 'transcribe' and subject = ? and clip = ? limit 1")
    .get(TRANSCRIBED_BY, clip);
  return row ? JSON.parse(row.output).text : null;
};

/** 一列数的平均，保留一位小数 */
const mean = (numbers) => Math.round((numbers.reduce((sum, n) => sum + n, 0) / numbers.length) * 10) / 10;

/** 跑完一家：每次调用报的用量相加成"这条录音的用量"，再对所有录音取平均 */
function summarize(label, usages, failed) {
  const fields = ["inputTokens", "audioTokens", "cachedTokens", "outputTokens", "thinkingTokens"];
  const summary = Object.fromEntries(fields.map((field) => [field, mean(usages.map((u) => u[field] ?? 0))]));
  console.log(JSON.stringify({ label, clips: usages.length, failed, ...summary }));
}

const seconds = clips.map(({ durationSec }) => durationSec);
console.log(JSON.stringify({ clips: clips.length, meanSeconds: mean(seconds) }));

for (const value of list(values.polish)) {
  const choice = parseChatChoice(value);
  const usages = [];
  let failed = 0;
  for (const clip of clips) {
    const transcript = transcriptOf(clip.id);
    if (!transcript?.trim()) continue;
    const calls = [];
    try {
      const polisher = await createChatPolisher({
        choice,
        apiKey: keyOf(choice.vendor),
        log: QUIET,
        onCall: (c) => calls.push(c),
      });
      await polisher.polish(transcript);
    } catch (error) {
      failed += 1;
      console.error(`${value} ${clip.id}: ${String(error?.detail ?? error?.message ?? error).slice(0, 160)}`);
      continue;
    }
    usages.push(sumCalls(calls));
  }
  summarize(`polish ${value}`, usages, failed);
}

for (const value of list(values.native)) {
  const choice = parseModelChoice(value);
  const usages = [];
  let failed = 0;
  let calls = [];
  // 思考档位照 App 的默认（设置里的 thinking），不写的话 Gemini 按它自己的默认开着思考
  const refiner = await createModelRefiner({
    choice,
    apiKey: keyOf(choice.provider),
    thinkingLevel: DEFAULT_THINKING_LEVEL,
    log: QUIET,
    onCall: (c) => calls.push(c),
  });
  for (const clip of clips) {
    calls = [];
    try {
      await refiner.refine(readFileSync(join(DATASET, clip.file)), { mimeType: "audio/wav" });
    } catch (error) {
      failed += 1;
      console.error(`${value} ${clip.id}: ${String(error?.detail ?? error?.message ?? error).slice(0, 160)}`);
      continue;
    }
    usages.push(sumCalls(calls));
  }
  summarize(`native ${value}`, usages, failed);
}

/** 一条录音可能调了不止一次（原生的长录音分块）：用量相加 */
function sumCalls(calls) {
  const total = {};
  for (const call of calls) {
    for (const [field, value] of Object.entries(call))
      if (typeof value === "number") total[field] = (total[field] ?? 0) + value;
  }
  return total;
}
