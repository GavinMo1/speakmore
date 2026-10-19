#!/usr/bin/env node
// 评词典的效果：同一批真实录音，每个模型各跑两遍（不带词典、带词典），数专有名词认对了几个、没说到的词有没有被硬塞进去。
// 走的是产品里的同一条路：本机模型经 loadTranscriber、云端转写经 createCloudTranscriber、原生经 createModelRefiner、
// 润色经 createChatPolisher，词典的收法和上限都按模型清单（vocabulary/support.mjs）。
//
//   node scripts/dev/eval-vocabulary.mjs prepare            从原版的历史里挑录音（含词典里的词的，加几条不含的当反例）
//   scripts/dev/with-key.sh gemini scripts/dev/with-key.sh openai … node scripts/dev/eval-vocabulary.mjs run [--targets a,b] [--force]
//   node scripts/dev/eval-vocabulary.mjs report             只出报告
//
// 录音、原文、各模型的成品都放在 bench/_work/vocabulary（在 git 之外：里面是说话的原文）。终端上只打数字。
// 每一格（模型 × 录音 × 带不带词典）跑过就存下来，再跑只补没跑的；--force 全部重跑。缺哪家的 key 就跳过哪家，照实说。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { BENCH_DECODERS } from "../../bench/lib/sources.mjs";
import { MODELS } from "../../src/models/catalog.mjs";
import { createCloudTranscriber } from "../../src/server/asr/cloud/transcriber.mjs";
import { CLOUD_TRANSCRIBERS } from "../../src/server/asr/cloud/vendors.mjs";
import { loadTranscriber } from "../../src/server/asr/engines/index.mjs";
import { decodeWav, encodeWav, SPEECH_SAMPLE_RATE } from "../../src/server/audio/pcm.mjs";
import { audioTypeOf, toSpeech } from "../../src/server/audio/transcode.mjs";
import { findChatVendor } from "../../src/server/chat/vendors.mjs";
import { findProvider } from "../../src/server/providers/index.mjs";
import { createChatPolisher } from "../../src/server/refine/polisher.mjs";
import { createModelRefiner } from "../../src/server/refine/refiner.mjs";
import { findVendor } from "../../src/server/vendors.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const WORK = join(ROOT, "bench/_work/vocabulary");
const CLIPS = join(WORK, "clips");
const RESULTS = join(WORK, "results");
const TYPELESS_DB = join(homedir(), "Library/Application Support/Typeless/typeless.db");
const QUIET = { info() {}, warn() {}, error() {} };

/** 作者在原版里的词典（2026-10-19 的截图 targets/typeless/_work/ui-reference/typeless-dictionary.png），写法照他平时的成品 */
const VOCABULARY = [
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
];
/**
 * 算分看的词：录音里真说了的专有名词。cli、App、agent 这类平常就会出现的词不算（认没认对看不出词典的功劳）。
 * 录音里说的是 Grok（原版成品写作 Grok），词典里是 Grok Bot：算 Grok 有没有写对
 */
const SCORED = ["Grok", "multica", "Runzo", "AE-PM", "Garmin", "埋点", "Claude Code", "全量"];
/** 硬塞检查看的词：词典里专有、平常不会顺手出现的那些 */
const DISTINCT = VOCABULARY.filter((term) => !["cli", "onboarding", "App", "agent", "load", "harness"].includes(term));
/** 每个算分的词挑几条录音，再挑几条一个词都不含的当反例 */
const PER_TERM = 3;
const NEGATIVES = 8;

/** 要评的模型：每一项是 [id, 用哪家的 key（本机的不要）, 装出来的东西] */
const TARGETS = [
  ...MODELS.map((model) => ({ id: `local/${model.id}`, kind: "local", model })),
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
  ].map(([provider, model]) => ({ id: `native/${provider}/${model}`, kind: "native", vendor: provider, model })),
  ...[
    ["deepseek", "deepseek-flash"],
    ["bailian", "qwen3.8-flash"],
  ].map(([vendor, model]) => ({ id: `polish/${vendor}/${model}`, kind: "polish", vendor, model })),
];
/** 润色的输入：本机 Qwen3-ASR 不带词典转出来的原文（同一份交给带不带词典的两遍，只看润色这一跳的差别） */
const POLISH_SOURCE = "local/qwen3-asr-0.6b-q8";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    targets: { type: "string" },
    force: { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
    "models-dir": { type: "string", default: join(ROOT, "bench/_work/models") },
  },
});
const command = positionals[0] ?? "report";

// ---------- 挑录音 ----------

async function prepare() {
  const db = new DatabaseSync(TYPELESS_DB, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT id, audio_local_path AS path, duration, refined_text AS text FROM history_v2
        WHERE status = 'completed' AND mode = 'voice_transcript' AND refined_text <> ''
          AND audio_local_path IS NOT NULL AND duration BETWEEN 4 AND 28
        ORDER BY created_at DESC`,
    )
    .all()
    .filter((row) => existsSync(row.path));
  db.close();
  const has = (row, term) => row.text.toLowerCase().includes(term.toLowerCase());
  const picked = new Map();
  for (const term of SCORED) {
    for (const row of rows.filter((each) => has(each, term)).slice(0, PER_TERM)) picked.set(row.id, row);
  }
  const clean = rows.filter((row) => !VOCABULARY.some((term) => has(row, term)));
  // 反例隔开挑，别都是同一天的
  const step = Math.floor(clean.length / NEGATIVES);
  for (let i = 0; i < NEGATIVES; i += 1) picked.set(clean[i * step].id, clean[i * step]);

  mkdirSync(CLIPS, { recursive: true });
  const manifest = [];
  for (const row of picked.values()) {
    const id = row.id.slice(0, 8);
    const bytes = readFileSync(row.path);
    const samples = await toSpeech(bytes, audioTypeOf(bytes), BENCH_DECODERS);
    writeFileSync(join(CLIPS, `${id}.wav`), encodeWav(samples, SPEECH_SAMPLE_RATE));
    manifest.push({ id, seconds: Math.round(row.duration * 10) / 10, reference: row.text });
  }
  writeFileSync(join(WORK, "clips.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const positives = manifest.filter((clip) => SCORED.some((term) => has({ text: clip.reference }, term))).length;
  console.log(
    `挑好了 ${manifest.length} 条：含词典里的词 ${positives} 条，反例 ${manifest.length - positives} 条 → ${WORK}`,
  );
}

// ---------- 跑 ----------

const resultFile = (target) => join(RESULTS, `${target.id.replaceAll("/", "__")}.json`);
const loadResults = (target) =>
  existsSync(resultFile(target)) ? JSON.parse(readFileSync(resultFile(target), "utf8")) : {};

/** 这一家的 key 在不在环境里（with-key.sh 喂进来的） */
const keyOf = (vendorId) => {
  const vendor = findVendor(vendorId);
  return vendor ? (process.env[vendor.keyEnv] ?? null) : null;
};

/** 装出一个 (samples 或原文, 词典) → 文字 的函数；缺 key 时回 null */
async function build(target) {
  if (target.kind === "local") {
    const dir = join(values["models-dir"], target.model.id);
    if (!existsSync(dir)) return { skip: `没有模型文件 ${dir}` };
    const transcriber = await loadTranscriber({ model: target.model, dir });
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
      run: (clip, vocabulary) => refiner.refine(clip.wav, { mimeType: "audio/wav", vocabulary }),
    };
  }
  if (!findChatVendor(target.vendor)) return { skip: `没有 ${target.vendor} 这一家` };
  const source = loadResults({ id: POLISH_SOURCE });
  const polisher = await createChatPolisher({
    choice: { vendor: target.vendor, model: target.model },
    apiKey,
    log: QUIET,
  });
  return {
    run: (clip, vocabulary) => {
      const transcript = source[clip.id]?.plain?.text;
      if (transcript === undefined) throw new Error(`先跑 ${POLISH_SOURCE}：润色要拿它不带词典的原文`);
      return polisher.polish(transcript, { vocabulary });
    },
  };
}

async function run() {
  const clips = JSON.parse(readFileSync(join(WORK, "clips.json"), "utf8")).map((clip) => {
    const wav = readFileSync(join(CLIPS, `${clip.id}.wav`));
    return { ...clip, wav, samples: decodeWav(wav).samples };
  });
  mkdirSync(RESULTS, { recursive: true });
  const wanted = values.targets?.split(",");
  // 润色要用本机模型的原文，排在后面
  const targets = TARGETS.filter((target) => !wanted || wanted.some((w) => target.id.includes(w)));
  const concurrency = Number(values.concurrency);
  for (const target of targets) {
    const built = await build(target);
    if (built.skip) {
      console.log(`跳过 ${target.id}：${built.skip}`);
      continue;
    }
    const results = values.force ? {} : loadResults(target);
    const cells = clips.flatMap((clip) =>
      [
        ["plain", []],
        ["vocabulary", VOCABULARY],
      ]
        .filter(([variant]) => !results[clip.id]?.[variant])
        .map(([variant, vocabulary]) => ({ clip, variant, vocabulary })),
    );
    // 本机模型一个一个转（同一个模型实例不并发），云端的几个一起发
    const width = target.kind === "local" ? 1 : concurrency;
    let failures = 0;
    const startedAt = performance.now();
    for (let i = 0; i < cells.length; i += width) {
      await Promise.all(
        cells.slice(i, i + width).map(async ({ clip, variant, vocabulary }) => {
          const t0 = performance.now();
          try {
            const text = await built.run(clip, vocabulary);
            results[clip.id] = { ...results[clip.id], [variant]: { text, ms: Math.round(performance.now() - t0) } };
          } catch (error) {
            failures += 1;
            results[clip.id] = {
              ...results[clip.id],
              [variant]: {
                error: String(error?.problem ? JSON.stringify(error.problem) : error?.message).slice(0, 300),
              },
            };
          }
        }),
      );
      writeFileSync(resultFile(target), `${JSON.stringify(results, null, 2)}\n`);
    }
    built.dispose?.();
    console.log(
      `${target.id}：${cells.length} 格，失败 ${failures}，${Math.round((performance.now() - startedAt) / 1000)} 秒`,
    );
  }
}

// ---------- 报告 ----------

function report() {
  const clips = JSON.parse(readFileSync(join(WORK, "clips.json"), "utf8"));
  const inText = (text, term) => text.toLowerCase().includes(term.toLowerCase());
  const exactIn = (text, term) => text.includes(term);
  const lines = [];
  lines.push("| 模型 | 认对（不带 → 带） | 写法全对（不带 → 带） | 硬塞的词（不带 → 带） | 失败 | 带词典多花的时间 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const target of TARGETS) {
    const results = loadResults(target);
    if (Object.keys(results).length === 0) continue;
    const tally = {
      plain: { hit: 0, exact: 0, inserted: 0, failed: 0, ms: [] },
      vocabulary: { hit: 0, exact: 0, inserted: 0, failed: 0, ms: [] },
    };
    let expected = 0;
    for (const clip of clips) {
      const terms = SCORED.filter((term) => inText(clip.reference, term));
      expected += terms.length;
      for (const variant of ["plain", "vocabulary"]) {
        const cell = results[clip.id]?.[variant];
        const t = tally[variant];
        if (!cell || cell.error) {
          t.failed += 1;
          continue;
        }
        t.ms.push(cell.ms);
        for (const term of terms) {
          if (inText(cell.text, term)) t.hit += 1;
          if (exactIn(cell.text, term)) t.exact += 1;
        }
        // 硬塞：成品里出现了词典里的专有词，参照里却没有
        t.inserted += DISTINCT.filter((term) => inText(cell.text, term) && !inText(clip.reference, term)).length;
      }
    }
    const median = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)] ?? 0;
    const extra = median(tally.vocabulary.ms) - median(tally.plain.ms);
    lines.push(
      `| ${target.id} | ${tally.plain.hit} → ${tally.vocabulary.hit} / ${expected} | ${tally.plain.exact} → ${tally.vocabulary.exact} | ${tally.plain.inserted} → ${tally.vocabulary.inserted} | ${tally.plain.failed + tally.vocabulary.failed} | ${extra >= 0 ? "+" : ""}${extra} ms |`,
    );
  }
  const text = lines.join("\n");
  writeFileSync(join(WORK, "report.md"), `${text}\n`);
  console.log(text);
}

// 函数和常量都定义完了再开始（顶层 await 会在后面的 const 初始化之前跑）
if (command === "prepare") await prepare();
else if (command === "run") {
  await run();
  report();
} else if (command === "report") report();
else throw new Error(`不认识的命令：${command}（prepare / run / report）`);
