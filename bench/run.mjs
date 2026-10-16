#!/usr/bin/env node
// 跑评测：参照（App 的原生链路）→ 各个本地模型转写 → 出报告。判分由 Claude 来，另走 judge.mjs。
// 每一格的结果按输入的指纹存进 _work/results.db，库里有的不再跑：全量、增量、只跑一部分都是同一个命令，
// 加了模型只跑它那一列，加了样本只跑新的行，改了提示词只重跑参照。详见 bench/README.md。
//
// 用法（参照要调 Gemini，key 经 with-key.sh 喂进来；只跑转写不用 key）：
//   scripts/dev/with-key.sh gemini node bench/run.mjs [选择] [--stages reference,transcribe] [--force] [--concurrency 4]
// 选择：--dataset default --candidates a,b --lang zh,mixed,en --limit 20 --clips id1,id2

import { join } from "node:path";
import { parseArgs } from "node:util";
import { createModelStore } from "../src/server/asr/store.mjs";
import { engineVersionsOf, fail, SELECTION_OPTIONS, saveReport, selectionFrom } from "./lib/cli.mjs";
import { WORK_DIR } from "./lib/dataset.mjs";
import { buildReport, collect } from "./lib/report.mjs";
import { openResults } from "./lib/results.mjs";
import { pendingJudgements } from "./lib/stages/judge.mjs";
import { runReference } from "./lib/stages/reference.mjs";
import { runTranscribe } from "./lib/stages/transcribe.mjs";

const STAGES = ["reference", "transcribe"];

const { values: args } = parseArgs({
  options: {
    ...SELECTION_OPTIONS,
    stages: { type: "string", default: STAGES.join(",") },
    force: { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
  },
});
const stages = args.stages.split(",");
for (const stage of stages) if (!STAGES.includes(stage)) fail(`不认识的环节：${stage}（有 ${STAGES.join("、")}）`);
const concurrency = Number(args.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1) fail(`--concurrency 要是正整数，现在是 ${args.concurrency}`);
const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey && stages.includes("reference")) {
  fail("参照要调 Gemini：scripts/dev/with-key.sh gemini node bench/run.mjs …；只跑转写加 --stages transcribe");
}

const selection = selectionFrom(args);
const { clips, candidates, datasetDir } = selection;
const results = openResults(join(WORK_DIR, "results.db"));
const store = createModelStore({ dir: join(WORK_DIR, "models") });
const engineVersions = await engineVersionsOf(candidates);
let failures = 0;
const showFailures = (label, failed) => {
  failures += failed.length;
  for (const { clip, candidate, error } of failed.slice(0, 5))
    console.error(`  ${label}失败 ${clip}${candidate ? ` · ${candidate}` : ""}：${error}`);
  if (failed.length > 5) console.error(`  ……还有 ${failed.length - 5} 条`);
};

console.log(
  `样本 ${clips.length} 条，候选 ${candidates.map((c) => c.id).join("、")}，环节 ${stages.join(" → ")}${args.force ? "（--force 全部重跑）" : ""}`,
);

if (stages.includes("reference")) {
  const { ran, failed } = await runReference({ clips, results, datasetDir, apiKey, concurrency, force: args.force });
  console.log(`参照：新跑 ${ran} 条，失败 ${failed.length} 条`);
  showFailures("参照", failed);
}

if (stages.includes("transcribe")) {
  for (const candidate of candidates) {
    try {
      const { ran, failed, info } = await runTranscribe({
        clips,
        candidate,
        results,
        store,
        datasetDir,
        force: args.force,
      });
      const detail = info
        ? `；跑在 ${info.backend}，加载 ${info.loadMs} ms，首次 ${info.coldMs} ms，内存峰值 ${info.maxRssMb} MB`
        : "";
      console.log(`转写 ${candidate.id}：新跑 ${ran} 条，失败 ${failed.length} 条${detail}`);
      showFailures("转写", failed);
    } catch (error) {
      // 一个候选崩了不拖累其他候选：已经转完的照样在库里，报出来接着跑下一个
      failures += 1;
      console.error(`转写 ${candidate.id} 中断：${error.message}`);
    }
  }
}

const { cells } = collect({ clips, candidates, results, engineVersions });
const { groups } = pendingJudgements(
  cells.filter((cell) => cell.transcript && cell.reference?.text),
  results,
);
const waiting = groups.reduce((sum, group) => sum + group.items.length, 0);
if (waiting > 0) console.log(`待判 ${waiting} 格：node bench/judge.mjs pending`);

const report = buildReport({ ...selection, results, engineVersions });
console.log(`\n${report.markdown}\n报告：${saveReport(report)}（细节在同名的 -details.md）`);
results.close();
if (failures > 0) process.exitCode = 1;
