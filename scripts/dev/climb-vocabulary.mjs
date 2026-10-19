#!/usr/bin/env node

// 在词典评测上爬山（claude-api skill 的 hillclimb 流程）：每轮只改一处讲词典的写法，跑一遍，训练集和测试集都涨才留。
// 三个 flow，各管一处写法、各跑用到它的模型：
//   native   原生识别的提示词里讲词典的那段（src/server/refine/prompt.mjs 的 nativePromptWith）
//   polish   润色的提示词里讲词典的那段（src/server/refine/polish-prompt.mjs 的 polishPromptWith）
//   context  百炼转写收的上下文（src/server/asr/cloud/bailian.mjs 的 contextOf）
//
//   node scripts/dev/climb-vocabulary.mjs split                                     切一次训练/测试（按录音），写各 flow 的 _state.json
//   scripts/dev/with-key.sh … node scripts/dev/climb-vocabulary.mjs run --flow native --variant baseline [--reps 2] [--approve-harness]
//   node scripts/dev/climb-vocabulary.mjs score --flow native                       各轮的训练/测试分数、和基线的配对差与 95% 区间
//
// 每个 flow 的目录是 bench/_work/hillclimb/vocabulary-<flow>/（在 git 之外：里面有说话的原文），布局照 skill 的约定
// （_state.json、<variant>/results.jsonl、summary.json、traces/、errors.jsonl），skill 自带的报告脚本能直接读。
// 录音、参照、算分（bench/lib/vocabulary.mjs）和这个脚本算"尺子"：它们变了就要 --approve-harness 重新认一次，免得尺子在爬的途中悄悄变了。

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { mapWithLimit } from "../../bench/lib/concurrency.mjs";
import {
  buildTarget,
  expectedTerms,
  findTarget,
  gradeText,
  POLISH_SOURCE,
  RARE,
  VOCABULARY,
} from "../../bench/lib/vocabulary.mjs";
import { contextOf } from "../../src/server/asr/cloud/bailian.mjs";
import { CLOUD_TRANSCRIBERS } from "../../src/server/asr/cloud/vendors.mjs";
import { decodeWav } from "../../src/server/audio/pcm.mjs";
import { polishPromptWith } from "../../src/server/refine/polish-prompt.mjs";
import { nativePromptWith } from "../../src/server/refine/prompt.mjs";
import { fitTerms, PROMPT_VOCABULARY } from "../../src/vocabulary/support.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const VOCAB_WORK = join(ROOT, "bench/_work/vocabulary");
const CLIMB_WORK = join(ROOT, "bench/_work/hillclimb");

const supportOf = (targetId) => {
  const [, vendor, model] = targetId.split("/");
  return CLOUD_TRANSCRIBERS.find((each) => each.id === vendor)?.models.find((each) => each.id === model)?.vocabulary;
};

/** 每个 flow：改的是哪个文件、跑哪些模型、模型实际收到的讲词典的那段长什么样（写进 trace 给分析的人看） */
const FLOWS = {
  native: {
    artifact: "src/server/refine/prompt.mjs",
    targets: ["native/gemini/gemini-3.6-flash", "native/openai/gpt-audio-mini", "native/bailian/qwen3.8-omni-flash"],
    instruction: () => nativePromptWith(fitTerms(VOCABULARY, PROMPT_VOCABULARY)),
  },
  polish: {
    artifact: "src/server/refine/polish-prompt.mjs",
    targets: ["polish/deepseek/deepseek-flash", "polish/bailian/qwen3.8-flash"],
    instruction: () => polishPromptWith(fitTerms(VOCABULARY, PROMPT_VOCABULARY)),
  },
  context: {
    artifact: "src/server/asr/cloud/bailian.mjs",
    targets: ["cloud/bailian/qwen3-asr-flash", "cloud/bailian/fun-asr-flash-2026-06-15"],
    instruction: (targetId) => contextOf(fitTerms(VOCABULARY, supportOf(targetId))),
  },
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    flow: { type: "string" },
    variant: { type: "string", default: "baseline" },
    reps: { type: "string", default: "2" },
    concurrency: { type: "string", default: "6" },
    "approve-harness": { type: "boolean", default: false },
  },
});
const command = positionals[0];

const flowDir = (flow) => join(CLIMB_WORK, `vocabulary-${flow}`);
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const readRows = (path) =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line))
    : [];

const loadClips = () =>
  readJson(join(VOCAB_WORK, "clips.json"), null) ?? fail("先跑 eval-vocabulary.mjs prepare 挑录音");
const shortModel = (targetId) => targetId.split("/").at(-1);
const caseId = (clipId, targetId) => `${clipId}_${shortModel(targetId)}`;
const kindOf = (clip) => {
  const expected = expectedTerms(clip.reference);
  if (expected.length === 0) return "negative";
  return expected.some((term) => RARE.includes(term)) ? "rare" : "common";
};

function fail(message) {
  console.error(message);
  process.exit(2);
}

// ---------- 切分 ----------

/** 固定种子的洗牌：同一份录音每次切出来一样 */
function shuffled(items, seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const SEED = 20261019;

/**
 * 按录音切（同一条录音在三个 flow、每个模型下都在同一边）。第一批 30 条开爬前看过各模型的输出，全放训练集；
 * 第二批按 生僻词 / 常见词 / 反例 分层，三分之一进训练、三分之二进测试。测试集只出分数，不给任何人读输出。
 */
function split() {
  const clips = loadClips();
  const train = clips.filter((clip) => clip.batch === 1).map((clip) => clip.id);
  const test = [];
  for (const kind of ["rare", "common", "negative"]) {
    const group = shuffled(
      clips.filter((clip) => clip.batch !== 1 && kindOf(clip) === kind).map((clip) => clip.id),
      SEED,
    );
    const cut = Math.round(group.length / 3);
    train.push(...group.slice(0, cut));
    test.push(...group.slice(cut));
  }
  for (const [flow, spec] of Object.entries(FLOWS)) {
    const dir = flowDir(flow);
    mkdirSync(dir, { recursive: true });
    const statePath = join(dir, "_state.json");
    const previous = readJson(statePath, {});
    const ids = (clipIds) => clipIds.flatMap((clipId) => spec.targets.map((targetId) => caseId(clipId, targetId)));
    writeJson(statePath, {
      ...previous,
      flow,
      artifact: spec.artifact,
      targets: spec.targets,
      seed: SEED,
      split_by: "clip",
      train_clips: train,
      test_clips: test,
      train_ids: ids(train),
      test_ids: ids(test),
      goal: { target: "pass", direction: "higher", hold: ["inserted"] },
      approve_each_round: false,
      metrics: [
        { id: "pass", kind: "binary", label: "全对" },
        { id: "recall", kind: "float", scale: 1, label: "认对率" },
        { id: "inserted", kind: "float", better: "lower", label: "硬塞" },
      ],
      harness_paths: harnessPaths(flow).map((path) => relative(ROOT, path)),
    });
  }
  const count = (ids) =>
    ["rare", "common", "negative"]
      .map((kind) => `${kind} ${ids.filter((id) => kindOf(clips.find((clip) => clip.id === id)) === kind).length}`)
      .join(" · ");
  console.log(`训练 ${train.length} 条（${count(train)}），测试 ${test.length} 条（${count(test)}）`);
}

// ---------- 尺子没变 ----------

/** 算分的尺子：这个脚本、录音清单和判法；润色还有它的输入（冻在 flow 目录里的本机转写原文） */
const harnessPaths = (flow) => [
  import.meta.filename,
  join(ROOT, "bench/lib/vocabulary.mjs"),
  join(VOCAB_WORK, "clips.json"),
  ...(flow === "polish" ? [join(flowDir(flow), "inputs.json")] : []),
];
const digest = (paths) => {
  const hash = createHash("sha256");
  for (const path of paths) hash.update(relative(ROOT, path)).update("\0").update(readFileSync(path)).update("\0");
  return hash.digest("hex");
};

function checkHarness(flow, state) {
  const statePath = join(flowDir(flow), "_state.json");
  const sha = digest(harnessPaths(flow));
  if (values["approve-harness"]) {
    writeJson(statePath, { ...state, harness_sha: sha });
    console.log(`认下了这把尺子：${sha.slice(0, 12)}`);
    return;
  }
  if (state.harness_sha !== sha)
    fail(
      `尺子变了（${harnessPaths(flow)
        .map((p) => relative(ROOT, p))
        .join("、")}）：看过改动再加 --approve-harness`,
    );
}

// ---------- 跑一轮 ----------

const RETRIES = 3;
async function withRetry(task, retried) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt + 1 >= RETRIES) throw error;
      retried.count += 1;
      // 退避加抖动，别让几路并发同时撞回去
      await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt * (0.5 + Math.random())));
    }
  }
}

const errorText = (error) =>
  String(error?.problem ? JSON.stringify(error.problem) : (error?.message ?? error)).slice(0, 300);

async function run() {
  const flow = values.flow;
  const spec = FLOWS[flow] ?? fail(`--flow 只能是 ${Object.keys(FLOWS).join(" / ")}`);
  const variant = values.variant;
  if (!/^(baseline|v[1-9]\d*)$/.test(variant)) fail("--variant 只能是 baseline 或 v<N>");
  const reps = Number(values.reps);
  const dir = flowDir(flow);
  const state = readJson(join(dir, "_state.json"), null) ?? fail("先跑 split");

  // 润色的输入冻在 flow 目录里：评测那边重跑本机转写也不会让这边的题悄悄变了
  if (flow === "polish" && !existsSync(join(dir, "inputs.json"))) {
    const source = readJson(join(VOCAB_WORK, "results", `${POLISH_SOURCE.replaceAll("/", "__")}.json`), {});
    const inputs = Object.fromEntries(
      loadClips().map((clip) => [clip.id, source[clip.id]?.plain?.text ?? fail(`${clip.id} 还没有本机转写的原文`)]),
    );
    writeJson(join(dir, "inputs.json"), inputs);
  }
  checkHarness(flow, readJson(join(dir, "_state.json"), state));

  const inputs = flow === "polish" ? readJson(join(dir, "inputs.json"), {}) : null;
  const clips = loadClips().map((clip) => {
    const wav = readFileSync(join(VOCAB_WORK, "clips", `${clip.id}.wav`));
    return { ...clip, wav, samples: decodeWav(wav).samples };
  });
  const vdir = join(dir, variant);
  mkdirSync(join(vdir, "traces"), { recursive: true });
  const resultsPath = join(vdir, "results.jsonl");
  const done = new Set(readRows(resultsPath).map((row) => `${row.prompt_id}\0${row.rep}`));

  const built = new Map();
  for (const targetId of spec.targets) {
    const target = findTarget(targetId) ?? fail(`没有 ${targetId}`);
    const b = await buildTarget(target, {
      modelsDir: join(ROOT, "bench/_work/models"),
      transcriptOf: (id) => inputs?.[id],
    });
    if (b.skip) fail(`${targetId}：${b.skip}`);
    built.set(targetId, b);
  }

  const tasks = [];
  for (const clip of clips)
    for (const targetId of spec.targets)
      for (let rep = 0; rep < reps; rep += 1)
        if (!done.has(`${caseId(clip.id, targetId)}\0${rep}`)) tasks.push({ clip, targetId, rep });
  console.log(
    `[${flow}/${variant}] 要跑 ${tasks.length} 格（${clips.length} 条 × ${spec.targets.length} 个模型 × ${reps} 遍，已有的跳过）`,
  );

  writeJson(join(vdir, "summary.json"), {
    ...readJson(join(vdir, "summary.json"), {}),
    target: flow === "context" ? "code" : "system_prompt",
    commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    artifact_dirty:
      execFileSync("git", ["status", "--porcelain", spec.artifact], { cwd: ROOT, encoding: "utf8" }).trim() !== "",
    harness_sha: readJson(join(dir, "_state.json"), {}).harness_sha,
  });

  let finished = 0;
  let failed = 0;
  const startedAt = Date.now();
  const ticker = setInterval(() => {
    const line = `${finished}/${tasks.length} 完成，失败 ${failed}，${Math.round((Date.now() - startedAt) / 1000)} 秒`;
    console.log(line);
    writeFileSync(join(vdir, "progress.txt"), `${line}\n`);
  }, 30_000);

  await mapWithLimit(tasks, Number(values.concurrency), async ({ clip, targetId, rep }) => {
    const id = caseId(clip.id, targetId);
    const retried = { count: 0 };
    const t0 = Date.now();
    try {
      const text = await withRetry(() => built.get(targetId).run(clip, VOCABULARY), retried);
      const grade = gradeText(text, clip.reference);
      const prompt = flow === "polish" ? inputs[clip.id] : `［录音 ${clip.id}，${clip.seconds} 秒］`;
      const row = {
        prompt_id: id,
        rep,
        prompt,
        tags: [targetId, kindOf(clip)],
        grade: {
          pass: grade.missed.length === 0 && grade.inserted.length === 0 ? 1 : 0,
          ...(grade.expected.length > 0
            ? { recall: (grade.expected.length - grade.missed.length) / grade.expected.length }
            : {}),
          inserted: grade.inserted.length,
        },
        explanation: {
          pass: [
            grade.missed.length > 0 ? `漏了 ${grade.missed.join("、")}` : null,
            grade.inserted.length > 0 ? `硬塞了 ${grade.inserted.join("、")}` : null,
            grade.inexact.length > 0 ? `写法不全对 ${grade.inexact.join("、")}` : null,
          ]
            .filter(Boolean)
            .join("；"),
        },
        model: shortModel(targetId),
        latency_s: (Date.now() - t0) / 1000,
        meta: { clip: clip.id, target: targetId, retries: retried.count, reference: clip.reference, ...grade },
      };
      writeJson(join(vdir, "traces", `${id}_rep${rep}.json`), [
        { role: "system", content: spec.instruction(targetId) },
        { role: "user", content: prompt },
        { role: "assistant", content: text },
      ]);
      appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
    } catch (error) {
      failed += 1;
      appendFileSync(
        join(vdir, "errors.jsonl"),
        `${JSON.stringify({ prompt_id: id, rep, retries: retried.count, error: errorText(error) })}\n`,
      );
    } finally {
      finished += 1;
    }
  });
  clearInterval(ticker);
  for (const b of built.values()) b.dispose?.();
  const rows = readRows(resultsPath).length;
  console.log(
    `[${flow}/${variant}] 完成：结果 ${rows} 行（应有 ${clips.length * spec.targets.length * reps}），这次失败 ${failed}`,
  );
}

// ---------- 分数 ----------

const meanOf = (numbers) => numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
const sdOf = (numbers) => {
  const m = meanOf(numbers);
  return Math.sqrt(numbers.reduce((sum, n) => sum + (n - m) ** 2, 0) / Math.max(1, numbers.length - 1));
};
/** 每格（录音 × 模型）各遍的平均 */
const perCase = (rows, metric) => {
  const byCase = new Map();
  for (const row of rows) {
    if (row.grade[metric] === undefined) continue;
    byCase.set(row.prompt_id, [...(byCase.get(row.prompt_id) ?? []), row.grade[metric]]);
  }
  return new Map([...byCase].map(([id, values]) => [id, meanOf(values)]));
};

/** 各轮在训练/测试上的分数，和基线的配对差（同一格各遍平均后相减）及 95% 区间；只打数字，不打任何输出 */
function score() {
  const flow = values.flow;
  if (!FLOWS[flow]) fail(`--flow 只能是 ${Object.keys(FLOWS).join(" / ")}`);
  const dir = flowDir(flow);
  const state = readJson(join(dir, "_state.json"), null) ?? fail("先跑 split");
  const variants = ["baseline", ...Array.from({ length: 50 }, (_, i) => `v${i + 1}`)].filter((v) =>
    existsSync(join(dir, v, "results.jsonl")),
  );
  const rowsOf = Object.fromEntries(variants.map((v) => [v, readRows(join(dir, v, "results.jsonl"))]));
  const sets = { train: new Set(state.train_ids), test: new Set(state.test_ids) };
  const lines = [
    "| 轮 | 改了什么 | 测试 全对 | 和基线差（95%） | 训练 全对 | 和基线差（95%） | 测试 硬塞 | 行数 | 失败 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const v of variants) {
    const change = existsSync(join(dir, v, "change.md"))
      ? readFileSync(join(dir, v, "change.md"), "utf8")
          .split("\n")
          .find((line) => line.trim())
          ?.replace(/^#+\s*/, "")
      : "基线";
    const cells = [v, change];
    for (const part of ["test", "train"]) {
      const mine = perCase(
        rowsOf[v].filter((row) => sets[part].has(row.prompt_id)),
        "pass",
      );
      const base = perCase(
        rowsOf.baseline.filter((row) => sets[part].has(row.prompt_id)),
        "pass",
      );
      cells.push(`${(meanOf([...mine.values()]) * 100).toFixed(1)}%`);
      if (v === "baseline") cells.push("—");
      else {
        const diffs = [...mine].filter(([id]) => base.has(id)).map(([id, value]) => value - base.get(id));
        const half = (1.96 * sdOf(diffs)) / Math.sqrt(diffs.length);
        cells.push(`${(meanOf(diffs) * 100).toFixed(1)} ± ${(half * 100).toFixed(1)}`);
      }
    }
    const inserted = rowsOf[v]
      .filter((row) => sets.test.has(row.prompt_id))
      .reduce((sum, row) => sum + row.grade.inserted, 0);
    cells.push(String(inserted), String(rowsOf[v].length), String(readRows(join(dir, v, "errors.jsonl")).length));
    lines.push(`| ${cells.join(" | ")} |`);
  }
  // 噪声：基线里同一格两遍结果不一样的比例（不改任何东西也会翻的那部分）
  const byCase = new Map();
  for (const row of rowsOf.baseline) byCase.set(row.prompt_id, [...(byCase.get(row.prompt_id) ?? []), row.grade.pass]);
  const multi = [...byCase.values()].filter((passes) => passes.length > 1);
  const flips = multi.filter((passes) => new Set(passes).size > 1).length;
  lines.push(
    "",
    `基线同一格两遍结果不同：${flips} / ${multi.length} 格（${((flips / Math.max(1, multi.length)) * 100).toFixed(1)}%）`,
  );
  // 各模型分开看（测试集）
  lines.push("", "| 轮 | 模型 | 测试 全对 | 测试 认对率 | 测试 硬塞 |", "| --- | --- | --- | --- | --- |");
  for (const v of variants)
    for (const targetId of state.targets) {
      const rows = rowsOf[v].filter((row) => sets.test.has(row.prompt_id) && row.tags[0] === targetId);
      const recall = rows.filter((row) => row.grade.recall !== undefined).map((row) => row.grade.recall);
      lines.push(
        `| ${v} | ${shortModel(targetId)} | ${(meanOf(rows.map((r) => r.grade.pass)) * 100).toFixed(1)}% | ${(meanOf(recall) * 100).toFixed(1)}% | ${rows.reduce((s, r) => s + r.grade.inserted, 0)} |`,
      );
    }
  console.log(lines.join("\n"));
}

if (command === "split") split();
else if (command === "run") await run();
else if (command === "score") score();
else
  fail(
    "用法：climb-vocabulary.mjs split | run --flow <native|polish|context> --variant <baseline|vN> | score --flow <…>",
  );
