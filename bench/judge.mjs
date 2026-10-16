#!/usr/bin/env node
// 判分：判官是开发时协作的 Claude（见 lib/stages/judge.mjs），这里只管导出待判的格子、收回判官的结论。
//
//   node bench/judge.mjs pending [选择] [--batch 15] [--force]
//     把还没判的格子按样本导出一批：_work/judge/pending.md 给判官看（评分标准、参照、各候选的转写和编号），
//     pending.json 留给 record 对账。空的转写直接记 0 分，不进这一批。
//   node bench/judge.mjs record <verdicts.jsonl>
//     判官一行一条 {"id":"编号","score":0-5,"problems":[…],"note":"一句话"}，校验全部对得上才存进结果库。
//
// 选择参数和 run.mjs 一样。判完一批再 pending 拿下一批，直到没有待判的。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { engineVersionsOf, fail, SELECTION_OPTIONS, selectionFrom } from "./lib/cli.mjs";
import { WORK_DIR } from "./lib/dataset.mjs";
import { collect } from "./lib/report.mjs";
import { openResults } from "./lib/results.mjs";
import { pendingJudgements, RUBRIC, recordEmpty, recordJudgements } from "./lib/stages/judge.mjs";

const DIR = join(WORK_DIR, "judge");
const BATCH_JSON = join(DIR, "pending.json");
const BATCH_MD = join(DIR, "pending.md");

const { values: args, positionals } = parseArgs({
  options: {
    ...SELECTION_OPTIONS,
    batch: { type: "string", default: "15" },
    force: { type: "boolean", default: false },
  },
  allowPositionals: true,
});
const [command, file] = positionals;
const results = openResults(join(WORK_DIR, "results.db"));

if (command === "pending") {
  const batch = Number(args.batch);
  if (!Number.isInteger(batch) || batch < 1) fail(`--batch 要是正整数，现在是 ${args.batch}`);
  const selection = selectionFrom(args);
  const { cells } = collect({ ...selection, results, engineVersions: await engineVersionsOf(selection.candidates) });
  const ready = cells.filter((cell) => cell.transcript && cell.reference?.text);
  const { groups, empty } = pendingJudgements(ready, results, { force: args.force });
  if (empty.length > 0) console.log(`空的转写 ${recordEmpty(results, empty)} 格，直接记了 0 分`);
  const chosen = groups.slice(0, batch);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(BATCH_JSON, JSON.stringify(chosen, null, 2));
  writeFileSync(BATCH_MD, markdownOf(chosen));
  const cellsIn = (list) => list.reduce((sum, group) => sum + group.items.length, 0);
  const missing = cells.length - ready.length;
  console.log(
    `待判 ${cellsIn(groups)} 格（${groups.length} 条样本），这一批 ${cellsIn(chosen)} 格（${chosen.length} 条）→ ${BATCH_MD}` +
      (missing > 0 ? `\n还有 ${missing} 格缺参照或转写，先跑 run.mjs 补上` : ""),
  );
} else if (command === "record") {
  if (!file) fail("用法：node bench/judge.mjs record <verdicts.jsonl>");
  if (!existsSync(BATCH_JSON)) fail("没有待判的一批：先跑 node bench/judge.mjs pending");
  const groups = JSON.parse(readFileSync(BATCH_JSON, "utf8"));
  const verdicts = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return fail(`${file} 第 ${index + 1} 行不是 JSON：${error.message}`);
      }
    });
  try {
    console.log(`存了 ${recordJudgements(results, verdicts, groups)} 格的判分`);
  } catch (error) {
    fail(error.message);
  }
  const judged = new Set(verdicts.map((verdict) => verdict.id));
  const left = groups.flatMap((group) => group.items).filter((item) => !judged.has(item.id)).length;
  if (left > 0) console.log(`这一批还有 ${left} 格没判`);
} else {
  fail("用法：node bench/judge.mjs pending [选择] [--batch 15] [--force] | record <verdicts.jsonl>");
}
results.close();

/** 给判官看的那一份：评分标准在前，每条样本一份参照，下面是各候选的转写 */
function markdownOf(groups) {
  const blocks = groups.map((group) =>
    [
      `## ${group.clip}（${group.lang}，${group.durationSec} 秒）`,
      `参照：${group.reference}`,
      ...group.items.map((item) => `- [${item.id}] ${item.candidates.join("、")}：${item.transcript}`),
    ].join("\n\n"),
  );
  return `# 待判\n\n${RUBRIC}\n\n${blocks.join("\n\n")}\n`;
}
