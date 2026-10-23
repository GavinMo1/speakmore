import { existsSync } from "node:fs";
import { join } from "node:path";
import { MODELS } from "../../src/models/catalog.mjs";
import { createCloudTranscriber } from "../../src/server/asr/cloud/transcriber.mjs";
import { CLOUD_TRANSCRIBERS } from "../../src/server/asr/cloud/vendors.mjs";
import { loadTranscriber } from "../../src/server/asr/engines/index.mjs";
import { findChatVendor } from "../../src/server/chat/vendors.mjs";
import { findProvider } from "../../src/server/providers/index.mjs";
import { createChatPolisher } from "../../src/server/refine/polisher.mjs";
import { createModelRefiner } from "../../src/server/refine/refiner.mjs";
import { findTask } from "../../src/server/tasks/index.mjs";
import { findVendor } from "../../src/server/vendors.mjs";

/** 语音输入这件事（src/server/tasks）：评测、量时间都是拿它跑 */
const DICTATION = findTask("dictate").bind({});

// 词典评测共用的部分：词典本身、哪些词算分、怎么判、要评的模型和怎么装出来。
// 两个入口用它：scripts/dev/eval-vocabulary.mjs（各模型带不带词典对比）和 scripts/dev/climb-vocabulary.mjs（爬山）。

/** 作者在原版里的词典（2026-10-19 的截图 targets/typeless/_work/ui-reference/typeless-dictionary.png），写法照他平时的成品 */
export const VOCABULARY = Object.freeze([
  "Grok Bot",
  "closing moon",
  "cli",
  "onboarding",
  "喜马拉雅式",
  "对数似然",
  "multica",
  "Runzo",
  "Claude Code",
  "Infobias",
  "AE-PM",
  "砍 feature",
  "chiikawa",
  "Garmin",
  "App",
  "词向量",
  "agent",
  "load",
  "HRV",
  "RHR",
  "朝正",
  "重庆大厦",
  "harness",
  "埋点",
  "极客思维",
  "国体",
  "全量",
]);

/**
 * 算分看的词：录音里真说了的专有名词。cli、App、agent 这类平常就会出现的词不算（认没认对看不出词典的功劳）。
 * 录音里说的是 Grok（原版成品写作 Grok 或 Grokbot），词典里是 Grok Bot：算 Grok 有没有写对。
 * 生僻的几个是词典真正要救的；常见的几个看词典有没有帮倒忙。
 */
export const RARE = Object.freeze(["Grok", "multica", "Runzo", "AE-PM", "Garmin", "harness"]);
export const COMMON = Object.freeze(["Claude Code", "埋点", "全量"]);
export const SCORED = Object.freeze([...RARE, ...COMMON]);

/** 硬塞检查看的词：词典里专有、平常不会顺手出现的那些 */
export const DISTINCT = Object.freeze(
  VOCABULARY.filter((term) => !["cli", "onboarding", "App", "agent", "load"].includes(term)),
);

/** 同一个词的别的对的写法：说"佳明"写佳明或 Garmin 都算对（2026-10-19 作者定的） */
export const ALIASES = Object.freeze({ Garmin: Object.freeze(["佳明"]) });

const formsOf = (term) => [term, ...(ALIASES[term] ?? [])];

/** 空格不算差别（Grokbot 对上 Grok Bot）；英文词前面不能紧挨字母（ngrok 不算 Grok） */
const patternOf = (term) =>
  new RegExp(
    `${/^[a-z]/i.test(term) ? "(?<![a-z])" : ""}${term
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*")}`,
    "i",
  );

/** 这个词（含别的对的写法）在文字里出没出现，不分大小写 */
export const mentions = (text, term) => formsOf(term).some((form) => patternOf(form).test(text));
/** 写法一字不差（大小写也对） */
const mentionsExactly = (text, term) => formsOf(term).some((form) => text.includes(form));

/** 这条录音该认出哪些词（照参照） */
export const expectedTerms = (reference) => SCORED.filter((term) => mentions(reference, term));

/**
 * 判一条成品：该认出的认出几个、写法全对几个、没说的词硬塞了几个。
 * @returns {{ expected: string[], missed: string[], inexact: string[], inserted: string[] }}
 */
export function gradeText(text, reference) {
  const expected = expectedTerms(reference);
  return {
    expected,
    missed: expected.filter((term) => !mentions(text, term)),
    inexact: expected.filter((term) => mentions(text, term) && !mentionsExactly(text, term)),
    inserted: DISTINCT.filter((term) => mentions(text, term) && !mentions(reference, term)),
  };
}

/** 要评的模型 */
export const TARGETS = Object.freeze([
  ...MODELS.map((model) => ({ id: `local/${model.id}`, kind: "local", model: model.id, catalog: model })),
  ...CLOUD_TRANSCRIBERS.flatMap((vendor) =>
    vendor.models.map((model) => ({
      id: `cloud/${vendor.id}/${model.id}`,
      kind: "cloud",
      vendor: vendor.id,
      model: model.id,
    })),
  ),
  ...[
    ["gemini", "gemini-3.6-flash"],
    ["openai", "gpt-audio-mini"],
    ["bailian", "qwen3.8-omni-flash"],
  ].map(([vendor, model]) => ({ id: `native/${vendor}/${model}`, kind: "native", vendor, model })),
  ...[
    ["deepseek", "deepseek-flash"],
    ["bailian", "qwen3.8-flash"],
  ].map(([vendor, model]) => ({ id: `polish/${vendor}/${model}`, kind: "polish", vendor, model })),
]);
export const findTarget = (id) => TARGETS.find((target) => target.id === id);

/** 润色的输入：本机 Qwen3-ASR 不带词典转出来的原文（带不带词典用同一份，只看润色这一跳的差别） */
export const POLISH_SOURCE = "local/qwen3-asr-0.6b-q8";

const QUIET = { info() {}, warn() {}, error() {} };

/** 这一家的 key 在不在环境里（with-key.sh 喂进来的） */
const keyOf = (vendorId) => {
  const vendor = findVendor(vendorId);
  return vendor ? (process.env[vendor.keyEnv] ?? null) : null;
};

/**
 * 装出一个模型：run(clip, vocabulary) → 文字。clip 是 { id, wav, samples }；润色还要 transcriptOf(clipId) 给原文。
 * 缺 key、缺模型文件时回 { skip: 原因 }。
 */
export async function buildTarget(target, { modelsDir, transcriptOf = null }) {
  if (target.kind === "local") {
    const dir = join(modelsDir, target.model);
    if (!existsSync(dir)) return { skip: `没有模型文件 ${dir}` };
    const transcriber = await loadTranscriber({ model: target.catalog, dir });
    return {
      run: async (clip, vocabulary) => (await transcriber.transcribe(clip.samples, { vocabulary })).text,
      dispose: () => transcriber.dispose(),
    };
  }
  const apiKey = keyOf(target.vendor);
  if (!apiKey) return { skip: `环境里没有 ${findVendor(target.vendor).keyEnv}` };
  if (target.kind === "cloud") {
    const transcriber = await createCloudTranscriber({
      choice: { vendor: target.vendor, model: target.model },
      apiKey,
      log: QUIET,
    });
    return { run: async (clip, vocabulary) => (await transcriber.transcribe(clip.samples, { vocabulary })).text };
  }
  if (target.kind === "native") {
    if (!findProvider(target.vendor)) return { skip: `没有 ${target.vendor} 这一家` };
    const refiner = await createModelRefiner({
      choice: { provider: target.vendor, model: target.model },
      apiKey,
      thinkingLevel: "MINIMAL",
      log: QUIET,
    });
    return {
      run: async (clip, vocabulary) =>
        (await refiner.refine(clip.wav, { task: DICTATION, mimeType: "audio/wav", vocabulary })).text,
    };
  }
  if (!findChatVendor(target.vendor)) return { skip: `没有 ${target.vendor} 这一家` };
  if (!transcriptOf) throw new Error("润色要给 transcriptOf：拿本机转写的原文");
  const polisher = await createChatPolisher({
    choice: { vendor: target.vendor, model: target.model },
    apiKey,
    log: QUIET,
  });
  return {
    run: async (clip, vocabulary) => {
      const transcript = transcriptOf(clip.id);
      if (transcript === undefined) throw new Error(`先跑 ${POLISH_SOURCE}：润色要拿它不带词典的原文（${clip.id}）`);
      return (await polisher.polish(transcript, { task: DICTATION, vocabulary })).text;
    },
  };
}
