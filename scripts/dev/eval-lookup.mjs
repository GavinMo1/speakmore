#!/usr/bin/env node
// 试划词翻译的提示词：一批手挑的句子（英译中、中译英、已是目标语言的、繁体、单词、代码报错、列表、日法），
// 按现在的翻译器（src/server/lookup/translator.mjs，含代码里判断"已是目标语言"）每句跑几遍，把原文和译文打印出来，
// 好坏由人看（判官是 Claude 自己，见 docs/implementation-notes.md 划词翻译一节）。句子都是造的，不是用户的内容。
//
// 用法：scripts/dev/with-key.sh deepseek node scripts/dev/eval-lookup.mjs [--vendor deepseek] [--model deepseek-flash] [--runs 2]

import { parseArgs } from "node:util";
import { findLanguage } from "../../src/languages.mjs";
import { CHAT_VENDORS } from "../../src/server/chat/vendors.mjs";
import { createChatTranslator } from "../../src/server/lookup/translator.mjs";

const { values } = parseArgs({
  options: {
    vendor: { type: "string", default: "deepseek" },
    model: { type: "string" },
    runs: { type: "string", default: "2" },
  },
});
values.runs = Number.parseInt(values.runs, 10);
const vendor = CHAT_VENDORS.find(({ id }) => id === values.vendor);
if (!vendor) throw new Error(`不认识的厂商：${values.vendor}`);
const apiKey = process.env[vendor.keyEnv];
if (!apiKey) throw new Error(`没有 ${vendor.keyEnv}：用 scripts/dev/with-key.sh ${vendor.id} 跑`);
const translator = await createChatTranslator({
  choice: { vendor: vendor.id, model: values.model ?? vendor.defaultModel },
  apiKey,
  log: { info() {}, warn: console.warn, error: console.error },
});

const CASES = [
  [
    "zh-CN",
    "The model keeps the audio on your device and only sends the transcript to the provider you choose. That split matters: audio is the most personal part of the pipeline.",
  ],
  [
    "zh-CN",
    "Latency is the other half of the story. Cold starts that used to take tens of seconds now finish in under two, which makes it practical to load a model only when someone starts talking.",
  ],
  [
    "zh-CN",
    "We're deprecating the v1 endpoints at the end of the quarter; please migrate to v2 before then to avoid any disruption.",
  ],
  [
    "zh-CN",
    "It's not that the old approach was wrong — it just didn't scale once we had more than a handful of customers.",
  ],
  ["zh-CN", "Thanks for flagging this! I'll take a look first thing tomorrow and circle back with an update."],
  [
    "zh-CN",
    "By default, the setting is turned off for privacy reasons, but you can enable it at any time from the preferences pane.",
  ],
  ["zh-CN", "In hindsight, we should have shipped the smaller version first and iterated from there."],
  ["zh-CN", "Error: connection refused. Make sure the server is running and accessible."],
  ["zh-CN", "Small speech models have quietly crossed a threshold."],
  ["zh-CN", "bear"],
  ["zh-CN", "不好意思，昨天回复晚了。合同我们这边法务已经过了一遍，有两处措辞想再商量一下。"],
  ["zh-CN", "這個模型把音頻留在你的裝置上。"],
  ["en", "这次改版主要是把设置页按功能拆开了，用起来顺手很多，老用户基本不用重新学。"],
  ["en", "Could you send us your comments on the contract by Friday?"],
  ["en", "pipeline"],
  ["ja", "Latency is the other half of the story."],
  ["ja", "モデルは音声を端末に残し、文字起こしだけを送信します。"],
  ["fr", "Before you deploy:\n\n1. Run the migrations\n2. Warm up the cache\n3. Flip the feature flag"],
];
for (const [to, text] of CASES) {
  const started = performance.now();
  const runs = await Promise.all(
    Array.from({ length: values.runs }, () =>
      translator.translate(text, { language: findLanguage(to), lookupId: "eval" }),
    ),
  );
  const lines = runs.map((run, index) => `${index + 1}（${run.language}）：${run.text}`);
  console.log(`=== 目标 ${to}（${Math.round(performance.now() - started)} ms）\n原文：${text}\n${lines.join("\n")}\n`);
}
