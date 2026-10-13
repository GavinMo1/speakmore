#!/usr/bin/env node
// 拿 Typeless 历史里的真实录音评估提示词：同一批录音用当前的提示词跑一遍，
// 和原版当时给出的成品比排版（分没分段、用没用列表、长短、文字出入），并数出明显的异常。
// 改提示词前后各跑一次，用 --label 区分，两次的数字就能直接对比。
//
// 用法：GEMINI_API_KEY 经按需加载器喂进来，然后
//   node scripts/eval-prompt.mjs --label <名字> [--out <目录>] [--concurrency 4]
// 第一次运行会抽样，把清单写进 <目录>/samples.json，之后每次都用这同一批。
// 加 --report-only 时不调模型，只拿这个标签上次的结果重新出一遍统计。
//
// 录音会发给 Gemini。清单和结果文件里有说话的原文，所以输出目录必须在 git 之外，
// 默认是 targets/typeless/_work/prompt-eval。终端上只打印统计数字，不打印文字。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.mjs";
import { createGeminiRefiner } from "../src/refiner.mjs";

const TYPELESS_DB = join(homedir(), "Library/Application Support/Typeless/typeless.db");
/** 按录音时长分层抽样：[下限秒, 上限秒, 抽几条]。长录音才会分段分点，所以往长的那头多抽 */
const SAMPLE_PLAN = [
  [0, 5, 4],
  [5, 10, 6],
  [10, 20, 12],
  [20, 40, 16],
  [40, 80, 14],
  [80, Number.POSITIVE_INFINITY, 8],
];
/** 原版的排版习惯按月在变（分段的比例从 46% 涨到 84%），只拿近期的当参照 */
const SAMPLE_SINCE = "2026-08";

const LIST_ITEM = /^\s*(\d+[.、)]|[-•*])\s/;
const END_MARK = /[。！？!?.…]$/;
/** 开头的一个外文词，后面紧跟中文或换行。模型偶尔会在成品前面多吐一个这样的词 */
const LEADING_FOREIGN_WORD = /^([A-Za-z_Ѐ-ӿ]+)[.\s]*(?=[一-鿿\n])/;
/** 只在繁体里出现的常用字，用来发现"简体的话被写成了繁体" */
const TRADITIONAL_ONLY =
  /[個這們來說為時會對過還進後開關當點體學實現經發問題種樣讓給從產業務員變萬與應該麼難聽寫話語買賣錢邊裡]/;

const quantile = (numbers, q) =>
  [...numbers].sort((a, b) => a - b)[Math.min(numbers.length - 1, Math.floor(numbers.length * q))];
const median = (numbers) => quantile(numbers, 0.5);
const fixed = (number, digits = 2) => number.toFixed(digits);

await main();

async function main() {
  const { values: args } = parseArgs({
    options: {
      label: { type: "string" },
      out: { type: "string", default: resolve(import.meta.dirname, "../../../_work/prompt-eval") },
      concurrency: { type: "string", default: "4" },
      "report-only": { type: "boolean", default: false },
    },
  });
  const concurrency = Number(args.concurrency);
  if (!args.label || !/^[\w.-]+$/.test(args.label) || !Number.isInteger(concurrency) || concurrency < 1) {
    console.error(
      "用法：node scripts/eval-prompt.mjs --label <名字，只用字母数字和 . _ -> [--out <目录>] [--concurrency 4] [--report-only]",
    );
    process.exit(2);
  }

  mkdirSync(args.out, { recursive: true });
  const samples = loadOrPickSamples(join(args.out, "samples.json"));
  const resultsPath = join(args.out, `${args.label}.json`);

  let results;
  if (args["report-only"]) {
    results = JSON.parse(readFileSync(resultsPath, "utf8"));
    console.log(`样本 ${samples.length} 条，标签 ${args.label}（用上次的结果，没有调模型）`);
  } else {
    const { gemini } = loadConfig(process.env);
    let retries = 0;
    const refiner = createGeminiRefiner({ ...gemini, log: { warn: () => retries++ } });
    console.log(`样本 ${samples.length} 条，模型 ${gemini.model} / ${gemini.thinkingLevel}，标签 ${args.label}`);
    // 进程里的第一次请求要多花一两秒建连接，先发掉，免得算进第一条样本的耗时
    await refiner.warmUp();
    results = await mapWithLimit(samples, concurrency, (sample) => runOne(refiner, sample));
    writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`因为成品写坏而重试：${retries} 次`);
    writeFileSync(join(args.out, `${args.label}.compare.md`), sideBySide(samples, results));
  }

  report(samples, results);
  if (results.some((result) => result.error)) process.exitCode = 1;
}

// ---------- 抽样 ----------

function loadOrPickSamples(manifestPath) {
  if (existsSync(manifestPath)) return JSON.parse(readFileSync(manifestPath, "utf8"));

  const db = new DatabaseSync(TYPELESS_DB, { readOnly: true });
  // id 是随机的 UUID，按 id 排序取前几条就是一份固定的随机样本，重跑也抽到同一批
  const pick = db.prepare(
    `SELECT id, duration, audio_local_path AS audioPath, refined_text AS reference
       FROM history_v2
      WHERE status = 'completed' AND mode = 'voice_transcript' AND refined_text <> ''
        AND created_at >= ? AND duration >= ? AND duration < ?
      ORDER BY id LIMIT ?`,
  );
  const picked = SAMPLE_PLAN.flatMap(([from, to, count]) =>
    // SQLite 没有无穷大，上限用一个比任何录音都长的数
    pick.all(SAMPLE_SINCE, from, Number.isFinite(to) ? to : 1e9, count),
  ).filter((sample) => existsSync(sample.audioPath));
  db.close();

  writeFileSync(manifestPath, JSON.stringify(picked, null, 2));
  return picked;
}

// ---------- 跑模型 ----------

async function runOne(refiner, sample) {
  const startedAt = performance.now();
  try {
    const text = await refiner.refine(readFileSync(sample.audioPath), { mimeType: "audio/ogg" });
    return { id: sample.id, ms: Math.round(performance.now() - startedAt), text };
  } catch (error) {
    return { id: sample.id, ms: Math.round(performance.now() - startedAt), error: String(error?.message ?? error) };
  }
}

async function mapWithLimit(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------- 比较 ----------

/** 一段成品的排版特征 */
function layoutOf(text) {
  return {
    paragraphs: text.split(/\n\s*\n/).filter((part) => part.trim()).length,
    items: text.split("\n").filter((line) => LIST_ITEM.test(line)).length,
    chars: text.replace(/\s/g, "").length,
    endsWithMark: END_MARK.test(text.trim()),
  };
}

/** 去掉标点和空白之后的文字有多像：1 是一字不差，0 是完全不同 */
function similarity(a, b) {
  const strip = (text) => text.toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
  const [x, y] = [strip(a), strip(b)];
  if (x.length === 0 && y.length === 0) return 1;
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[y.length] / Math.max(x.length, y.length);
}

/** 一眼就能看出不对的成品：这些不是"写得不够好"，是坏了 */
function defectsOf(ours, reference) {
  const defects = [];
  const [oursChars, referenceChars] = [layoutOf(ours).chars, layoutOf(reference).chars];
  if (referenceChars >= 20 && oursChars < referenceChars / 2) defects.push("只出了一小截");
  const leading = ours.match(LEADING_FOREIGN_WORD)?.[1];
  // 原版里也有这个词就是他真说了（比如以"UI"开头的话），不算多出来的
  if (leading && !new RegExp(`\\b${leading}\\b`, "i").test(reference)) defects.push("开头多出外文词");
  if (/_{3,}/.test(ours)) defects.push("一串下划线");
  // 模型听音频时自带"几分几秒"的定位，偶尔会把它写进成品。他真说了几个钟点的话原版里也会有
  const timestamps = (text) => text.match(/\b\d{1,2}:\d{2}\b/g)?.length ?? 0;
  if (timestamps(ours) >= 3 && timestamps(reference) === 0) defects.push("夹着时间戳");
  if (TRADITIONAL_ONLY.test(ours) && !TRADITIONAL_ONLY.test(reference)) defects.push("写成了繁体");
  // 同一个字或词紧挨着重复三遍以上：口吃没删掉。原版里也这样的（"重做，重做，重做"）不算
  const stutter = /([一-鿿]{1,3})\1{2,}/;
  if (stutter.test(ours) && !stutter.test(reference.replace(/[\p{P}\s]/gu, ""))) defects.push("口吃没删");
  return defects;
}

function report(samples, results) {
  const failed = results.filter((result) => result.error);
  for (const failure of failed) console.log(`  失败 ${failure.id.slice(0, 8)}：${failure.error}`);

  const rows = samples
    .map((sample, index) => ({ sample, result: results[index] }))
    .filter(({ result }) => !result.error)
    .map(({ sample, result }) => ({
      id: sample.id,
      duration: sample.duration,
      ms: result.ms,
      ref: layoutOf(sample.reference),
      ours: layoutOf(result.text),
      similarity: similarity(sample.reference, result.text),
      defects: defectsOf(result.text, sample.reference),
    }));
  if (rows.length === 0) return;

  const count = (predicate) => rows.filter(predicate).length;
  const ms = rows.map((row) => row.ms);
  console.log(`成功 ${rows.length} 条，失败 ${failed.length} 条`);
  console.log(`耗时：中位 ${fixed(median(ms) / 1000, 1)} 秒，P90 ${fixed(quantile(ms, 0.9) / 1000, 1)} 秒`);

  const broken = rows.filter((row) => row.defects.length > 0);
  const byKind = Map.groupBy(
    broken.flatMap((row) => row.defects.map((defect) => ({ defect, id: row.id.slice(0, 8) }))),
    ({ defect }) => defect,
  );
  console.log(`坏掉的成品：${broken.length} 条`);
  for (const [kind, hits] of byKind) console.log(`  ${kind} ${hits.length} 条：${hits.map((hit) => hit.id).join(" ")}`);

  const refBroke = (row) => row.ref.paragraphs > 1;
  const oursBroke = (row) => row.ours.paragraphs > 1;
  console.log(
    `分段：原版分了 ${count(refBroke)} 条，其中我们也分了 ${count((row) => refBroke(row) && oursBroke(row))} 条；` +
      `原版没分 ${count((row) => !refBroke(row))} 条，其中我们分了 ${count((row) => !refBroke(row) && oursBroke(row))} 条`,
  );
  const refListed = (row) => row.ref.items > 0;
  const oursListed = (row) => row.ours.items > 0;
  console.log(
    `列表：原版用了 ${count(refListed)} 条，其中我们也用了 ${count((row) => refListed(row) && oursListed(row))} 条；` +
      `原版没用 ${count((row) => !refListed(row))} 条，其中我们用了 ${count((row) => !refListed(row) && oursListed(row))} 条`,
  );
  const refParagraphs = rows.map((row) => row.ref.paragraphs);
  const oursParagraphs = rows.map((row) => row.ours.paragraphs);
  const paragraphGap = rows.reduce((sum, row) => sum + Math.abs(row.ours.paragraphs - row.ref.paragraphs), 0);
  console.log(
    `段落数：原版中位 ${median(refParagraphs)}，我们中位 ${median(oursParagraphs)}，平均相差 ${fixed(paragraphGap / rows.length)}`,
  );
  const ratio = rows.filter((row) => row.ref.chars > 0).map((row) => row.ours.chars / row.ref.chars);
  console.log(
    `字数比（我们 ÷ 原版）：P10 ${fixed(quantile(ratio, 0.1))}，中位 ${fixed(median(ratio))}，P90 ${fixed(quantile(ratio, 0.9))}`,
  );
  const alike = rows.map((row) => row.similarity);
  console.log(`文字相似度（不算标点空白）：P10 ${fixed(quantile(alike, 0.1))}，中位 ${fixed(median(alike))}`);
  console.log(
    `结尾有标点：原版 ${count((row) => row.ref.endsWithMark)} 条，我们 ${count((row) => row.ours.endsWithMark)} 条；` +
      `输出为空 ${count((row) => row.ours.chars === 0)} 条`,
  );

  console.log("按时长（条数 | 原版分段 / 我们分段 | 原版列表 / 我们列表 | 相似度中位）");
  for (const [from, to] of SAMPLE_PLAN) {
    const bucket = rows.filter((row) => row.duration >= from && row.duration < to);
    if (bucket.length === 0) continue;
    const n = (predicate) => String(bucket.filter(predicate).length).padStart(2);
    const range = `${String(from).padStart(2)}–${Number.isFinite(to) ? String(to).padEnd(2) : "∞ "}`;
    console.log(
      `  ${range} 秒：${n(() => true)} | ${n(refBroke)} / ${n(oursBroke)} | ${n(refListed)} / ${n(oursListed)} | ` +
        fixed(median(bucket.map((row) => row.similarity))),
    );
  }
}

/** 逐条把原版和我们的成品排在一起，人工看差别用 */
function sideBySide(samples, results) {
  return samples
    .map((sample, index) => {
      const result = results[index];
      const ours = result.error ? `（失败：${result.error}）` : result.text || "（空）";
      return (
        `## ${sample.id.slice(0, 8)}  ${sample.duration.toFixed(1)} 秒  ${result.ms} ms\n\n` +
        `### 原版\n\n${sample.reference}\n\n### 我们\n\n${ours}\n`
      );
    })
    .join("\n---\n\n");
}
