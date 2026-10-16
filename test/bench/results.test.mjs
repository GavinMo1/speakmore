import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fingerprint, openResults } from "../../bench/lib/results.mjs";

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDb = () => {
  const dir = mkdtempSync(join(tmpdir(), "speakmore-bench-"));
  dirs.push(dir);
  return join(dir, "results.db");
};

test("指纹：同样的输入不论键的顺序都一样，任何一样变了就不一样", () => {
  const a = fingerprint({ clip: "x", model: { id: "m", revision: "r" }, options: { threads: 4 } });
  assert.equal(a, fingerprint({ options: { threads: 4 }, model: { revision: "r", id: "m" }, clip: "x" }));
  assert.notEqual(a, fingerprint({ clip: "x", model: { id: "m", revision: "r" }, options: { threads: 8 } }));
  assert.notEqual(a, fingerprint({ clip: "y", model: { id: "m", revision: "r" }, options: { threads: 4 } }));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("结果库：按环节和指纹存取；没有的是 null；同一格再存一次是覆盖（--force 重跑）", () => {
  const results = openResults(tempDb());
  assert.equal(results.get("transcribe", "k1"), null);
  results.put("transcribe", "k1", { clip: "c1", subject: "qwen", output: { text: "你好", ms: 120 } });
  assert.deepEqual(results.get("transcribe", "k1"), { text: "你好", ms: 120 });
  assert.equal(results.get("judge", "k1"), null, "不同环节互不相干");
  results.put("transcribe", "k1", { clip: "c1", subject: "qwen", output: { text: "您好", ms: 99 } });
  assert.deepEqual(results.get("transcribe", "k1"), { text: "您好", ms: 99 });
  results.close();
});

test("结果库：每个候选跑过一轮记一笔（加载耗时、内存…），报告取最近的那一笔", () => {
  const path = tempDb();
  const results = openResults(path);
  results.addRun("qwen", { loadMs: 900 });
  results.addRun("sensevoice", { loadMs: 300 });
  results.addRun("qwen", { loadMs: 800 });
  results.close();
  const reopened = openResults(path);
  assert.deepEqual(reopened.latestRun("qwen"), { loadMs: 800 });
  assert.equal(reopened.latestRun("nope"), null);
  reopened.close();
});
