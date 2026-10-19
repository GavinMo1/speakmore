#!/usr/bin/env node
// 评词典的效果：同一批真实录音，每个模型各跑两遍（不带词典、带词典），数专有名词认对了几个、没说到的词有没有被硬塞进去。
// 词典、算分的词、怎么判、要评的模型在 bench/lib/vocabulary.mjs（爬山的 climb-vocabulary.mjs 也用它）。
// 走的是产品里的同一条路：本机模型经 loadTranscriber、云端转写经 createCloudTranscriber、原生经 createModelRefiner、
// 润色经 createChatPolisher，词典的收法和上限都按模型清单（vocabulary/support.mjs）。
//
//   node scripts/dev/eval-vocabulary.mjs prepare            从原版的历史里挑录音（含词典里的词的，加几条不含的当反例）；已挑的留着，只补新的
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
import {
  buildTarget,
  COMMON,
  gradeText,
  mentions,
  POLISH_SOURCE,
  RARE,
  TARGETS,
  VOCABULARY,
} from "../../bench/lib/vocabulary.mjs";
import { decodeWav, encodeWav, SPEECH_SAMPLE_RATE } from "../../src/server/audio/pcm.mjs";
import { audioTypeOf, toSpeech } from "../../src/server/audio/transcode.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const WORK = join(ROOT, "bench/_work/vocabulary");
const CLIPS = join(WORK, "clips");
const RESULTS = join(WORK, "results");
const TYPELESS_DB = join(homedir(), "Library/Application Support/Typeless/typeless.db");

/** 挑录音：生僻词的全要（本来就少），常见词的每个隔开挑几条，再隔开挑反例（一个词典里的词都不含的） */
const MAX_SECONDS = 90;
const PER_COMMON = 12;
const NEGATIVES = 40;

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

/** 从一串里隔开挑 count 条（别都是同一天的） */
const spaced = (rows, count) => {
  if (rows.length <= count) return rows;
  const step = rows.length / count;
  return Array.from({ length: count }, (_, i) => rows[Math.floor(i * step)]);
};

/**
 * 挑录音。已经挑过的留着、编号不变（之前的评测结果和爬山的切分都认这些编号），只补新的；
 * 每条记下是第几批挑进来的（batch），爬山切分时用。
 */
async function prepare() {
  const db = new DatabaseSync(TYPELESS_DB, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT id, audio_local_path AS path, duration, refined_text AS text FROM history_v2
        WHERE status = 'completed' AND mode = 'voice_transcript' AND refined_text <> ''
          AND audio_local_path IS NOT NULL AND duration BETWEEN 4 AND ?
        ORDER BY created_at DESC`,
    )
    .all(MAX_SECONDS)
    .filter((row) => existsSync(row.path));
  db.close();
  const manifestPath = join(WORK, "clips.json");
  const kept = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8")).map((clip) => ({ batch: 1, ...clip }))
    : [];
  const batch = Math.max(0, ...kept.map((clip) => clip.batch)) + 1;
  const has = new Set(kept.map((clip) => clip.id));
  const fresh = rows.filter((row) => !has.has(row.id.slice(0, 8)));

  const picked = new Map();
  for (const term of RARE) for (const row of fresh.filter((each) => mentions(each.text, term))) picked.set(row.id, row);
  for (const term of COMMON) {
    const candidates = fresh.filter((each) => mentions(each.text, term) && !picked.has(each.id));
    const already = kept.filter((clip) => mentions(clip.reference, term)).length;
    for (const row of spaced(candidates, Math.max(0, PER_COMMON - already))) picked.set(row.id, row);
  }
  const isNegative = (text) => !VOCABULARY.some((term) => mentions(text, term));
  const negativesKept = kept.filter((clip) => isNegative(clip.reference)).length;
  for (const row of spaced(
    fresh.filter((row) => isNegative(row.text)),
    NEGATIVES - negativesKept,
  ))
    picked.set(row.id, row);

  mkdirSync(CLIPS, { recursive: true });
  const added = [];
  for (const row of picked.values()) {
    const id = row.id.slice(0, 8);
    const bytes = readFileSync(row.path);
    const samples = await toSpeech(bytes, audioTypeOf(bytes), BENCH_DECODERS);
    writeFileSync(join(CLIPS, `${id}.wav`), encodeWav(samples, SPEECH_SAMPLE_RATE));
    added.push({ id, seconds: Math.round(row.duration * 10) / 10, reference: row.text, batch });
  }
  const manifest = [...kept, ...added];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const negatives = manifest.filter((clip) => isNegative(clip.reference)).length;
  console.log(`新挑 ${added.length} 条，共 ${manifest.length} 条：反例 ${negatives} 条 → ${WORK}`);
}

// ---------- 跑 ----------

const resultFile = (target) => join(RESULTS, `${target.id.replaceAll("/", "__")}.json`);
const loadResults = (target) =>
  existsSync(resultFile(target)) ? JSON.parse(readFileSync(resultFile(target), "utf8")) : {};
const polishSource = () => {
  const results = loadResults({ id: POLISH_SOURCE });
  return (clipId) => results[clipId]?.plain?.text;
};

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
    const built = await buildTarget(target, { modelsDir: values["models-dir"], transcriptOf: polishSource() });
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
        // 失败的格也记下了错误，重跑时要再试
        .filter(([variant]) => !results[clip.id]?.[variant] || results[clip.id][variant].error)
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
      for (const variant of ["plain", "vocabulary"]) {
        const cell = results[clip.id]?.[variant];
        const t = tally[variant];
        if (variant === "plain") expected += gradeText("", clip.reference).expected.length;
        if (!cell || cell.error) {
          t.failed += 1;
          continue;
        }
        t.ms.push(cell.ms);
        const grade = gradeText(cell.text, clip.reference);
        t.hit += grade.expected.length - grade.missed.length;
        t.exact += grade.expected.length - grade.missed.length - grade.inexact.length;
        t.inserted += grade.inserted.length;
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
