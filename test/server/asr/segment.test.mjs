import assert from "node:assert/strict";
import { test } from "node:test";
import { joinTexts, splitPoints } from "../../../src/server/asr/segment.mjs";

const RATE = 16_000;
/** 一段"录音"：说话（440 Hz 的音）和停顿（静音）交替，单位秒 */
function speech(pattern) {
  const parts = pattern.map(([kind, seconds]) =>
    Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
      kind === "talk" ? 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE) : 0,
    ),
  );
  const all = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return all;
}

test("分段：不超过上限的录音整段交出去", () => {
  assert.deepEqual(splitPoints(speech([["talk", 12]]), RATE, 20), [[0, 12 * RATE]]);
});

test("分段：长录音切在停顿里，每段都不超过上限，首尾相接不丢一个样本", () => {
  // 说 9 秒、停 0.6 秒、说 9 秒、停 0.6 秒、说 9 秒、停 0.6 秒、说 9 秒 ≈ 37.8 秒
  const samples = speech([
    ["talk", 9],
    ["quiet", 0.6],
    ["talk", 9],
    ["quiet", 0.6],
    ["talk", 9],
    ["quiet", 0.6],
    ["talk", 9],
  ]);
  const segments = splitPoints(samples, RATE, 20);
  assert.ok(segments.length >= 2);
  assert.equal(segments[0][0], 0);
  assert.equal(segments.at(-1)[1], samples.length);
  for (let i = 1; i < segments.length; i++) assert.equal(segments[i][0], segments[i - 1][1], "首尾相接");
  for (const [start, end] of segments) assert.ok(end - start <= 20 * RATE, `${(end - start) / RATE} 秒`);
  // 每个切点都落在某一段静音里
  const quiet = [
    [9, 9.6],
    [18.6, 19.2],
    [28.2, 28.8],
  ].map(([a, b]) => [a * RATE, b * RATE]);
  for (const [, end] of segments.slice(0, -1)) {
    assert.ok(
      quiet.some(([a, b]) => end >= a && end <= b),
      `切在 ${end / RATE} 秒`,
    );
  }
});

test("分段：一直在说、没有停顿，也按上限切开，不会切出超长的一段", () => {
  const segments = splitPoints(speech([["talk", 50]]), RATE, 20);
  assert.equal(segments.at(-1)[1], 50 * RATE);
  for (const [start, end] of segments) assert.ok(end - start <= 20 * RATE);
});

test("接文字：中文直接接，两边都是英文或数字时加一个空格；空的段跳过", () => {
  assert.equal(joinTexts(["我们后天开会。", "记得带上数据。"]), "我们后天开会。记得带上数据。");
  assert.equal(joinTexts(["把代码推到 GitHub", "然后开 PR"]), "把代码推到 GitHub然后开 PR");
  assert.equal(joinTexts(["deploy to", "staging now"]), "deploy to staging now");
  assert.equal(joinTexts(["", " 好的 ", ""]), "好的");
});
