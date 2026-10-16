import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { openResults } from "../../bench/lib/results.mjs";
import { judgeKey, pendingJudgements, recordEmpty, recordJudgements } from "../../bench/lib/stages/judge.mjs";

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempResults() {
  const dir = mkdtempSync(join(tmpdir(), "speakmore-judge-"));
  dirs.push(dir);
  return openResults(join(dir, "results.db"));
}

const clip = (id) => ({ id, lang: "zh", durationSec: 3 });
const cell = (clipId, candidate, reference, transcript) => ({
  clip: clip(clipId),
  candidate: { id: candidate },
  reference: { text: reference },
  transcript: { text: transcript },
});

test("待判：按样本分组，一份参照下面列各个候选；转得一模一样的并成一项，只判一次", () => {
  const results = tempResults();
  const { groups, empty } = pendingJudgements(
    [
      cell("c1", "a", "我们后天开会", "我们后天开会"),
      cell("c1", "b", "我们后天开会", "我们后天开会"),
      cell("c1", "c", "我们后天开会", "我们明天开会"),
      cell("c2", "a", "好的", "好的"),
    ],
    results,
  );
  assert.deepEqual(empty, []);
  assert.deepEqual(
    groups.map((group) => [group.clip, group.reference, group.items.map((item) => [item.candidates, item.transcript])]),
    [
      [
        "c1",
        "我们后天开会",
        [
          [["a", "b"], "我们后天开会"],
          [["c"], "我们明天开会"],
        ],
      ],
      ["c2", "好的", [[["a"], "好的"]]],
    ],
  );
  assert.equal(groups[0].items[0].id, judgeKey("我们后天开会", "我们后天开会").slice(0, 12));
  results.close();
});

test("待判：判过的不再导出（--force 才重判）；空的转写不给判官看，直接记 0 分", () => {
  const results = tempResults();
  const cells = [cell("c1", "a", "好的", "好的"), cell("c1", "b", "好的", " ")];
  const first = pendingJudgements(cells, results);
  assert.equal(first.empty.length, 1);
  recordEmpty(results, first.empty);
  assert.deepEqual(results.get("judge", judgeKey("好的", " ")), {
    score: 0,
    problems: ["认不出"],
    note: "转写是空的",
    by: "rule",
  });
  recordJudgements(results, [{ id: first.groups[0].items[0].id, score: 5, problems: [], note: "无" }], first.groups);
  assert.deepEqual(pendingJudgements(cells, results), { groups: [], empty: [] });
  assert.equal(pendingJudgements(cells, results, { force: true }).groups.length, 1);
  results.close();
});

test("记分：存进库里，记着是谁判的；一批里有一处不对就整批不存，并逐条说清", () => {
  const results = tempResults();
  const { groups } = pendingJudgements([cell("c1", "a", "参照", "转写一"), cell("c1", "b", "参照", "转写二")], results);
  const [one, two] = groups[0].items.map((item) => item.id);
  assert.throws(
    () =>
      recordJudgements(
        results,
        [
          { id: one, score: 4, problems: ["字词错"], note: "一个同音字" },
          { id: two, score: 6, problems: ["错别字"], note: "" },
          { id: "nope", score: 3, problems: [], note: "?" },
        ],
        groups,
      ),
    (error) =>
      /有 4 处不对/.test(error.message) &&
      /0–5 的整数/.test(error.message) &&
      /只能从/.test(error.message) &&
      /note 不能是空的/.test(error.message) &&
      /没有这个编号/.test(error.message),
  );
  assert.equal(results.get("judge", judgeKey("参照", "转写一")), null, "整批都没存");
  assert.equal(
    recordJudgements(
      results,
      [
        { id: one, score: 4, problems: ["字词错"], note: "一个同音字" },
        { id: two, score: 2, problems: ["漏内容"], note: "后半段没了" },
      ],
      groups,
    ),
    2,
  );
  assert.deepEqual(results.get("judge", judgeKey("参照", "转写二")), {
    score: 2,
    problems: ["漏内容"],
    note: "后半段没了",
    by: "claude-opus-5-5",
  });
  results.close();
});
