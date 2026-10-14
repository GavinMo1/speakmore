import assert from "node:assert/strict";
import { test } from "node:test";
import { renderUsage } from "../../../src/cli/render/usage.mjs";
import { plain } from "./fixtures.mjs";

/** 报表里的一段（src/usage/report.mjs 给的样子） */
const period = (overrides = {}) => ({
  calls: 0,
  checks: 0,
  dictations: 0,
  inputTokens: 0,
  audioTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  costUsd: 0,
  unpricedCalls: 0,
  tokens: 0,
  latency: null,
  ...overrides,
});

const report = {
  today: period({
    calls: 12,
    dictations: 12,
    costUsd: 0.0191,
    tokens: 21_300,
    latency: { medianMs: 1600, p90Ms: 2400 },
  }),
  month: period({
    calls: 212,
    dictations: 210,
    costUsd: 0.31,
    tokens: 350_400,
    latency: { medianMs: 1700, p90Ms: 2600 },
  }),
  total: period({
    calls: 834,
    checks: 14,
    dictations: 820,
    inputTokens: 1_380_000,
    audioTokens: 120_000,
    cachedTokens: 0,
    outputTokens: 20_000,
    thinkingTokens: 0,
    costUsd: 1.24,
    tokens: 1_400_000,
    latency: { medianMs: 1700, p90Ms: 2600 },
  }),
  models: [
    {
      provider: "gemini",
      model: "gemini-3.6-flash",
      ...period({
        calls: 734,
        dictations: 720,
        costUsd: 1.1,
        tokens: 1_200_000,
        latency: { medianMs: 1700, p90Ms: 2500 },
      }),
    },
    {
      provider: "openai",
      model: "gpt-audio-mini-2025-12-15",
      ...period({
        calls: 100,
        dictations: 90,
        costUsd: 0.14,
        tokens: 200_000,
        latency: { medianMs: 2600, p90Ms: 3100 },
      }),
    },
  ],
};

const lines = (text) => text.split("\n").map((line) => line.trimEnd());

test("今天、本月、累计各一行：花费、token、几次听写、模型一般多久回话、慢的时候多久，列对齐", () => {
  const text = lines(renderUsage(report, plain));
  assert.match(text[0], /^用量/);
  const rows = ["今天", "本月", "累计"].map((label) => text.find((line) => line.startsWith(`  ${label}`)));
  assert.match(rows[0], /今天\s+\$0\.019\s+21\.3K\s+12\s+一般 1\.6 秒，慢时 2\.4 秒$/);
  assert.match(rows[1], /本月\s+\$0\.31\s+350K\s+210\s+一般 1\.7 秒，慢时 2\.6 秒$/);
  assert.match(rows[2], /累计\s+\$1\.24\s+1\.4M\s+820\s+一般 1\.7 秒，慢时 2\.6 秒$/);
  // token 那一列右对齐：三行的结尾在同一列
  const ends = rows.map((row) => row.search(/\d(K|M)\s/));
  assert.equal(new Set(ends.map((end, i) => end + rows[i].match(/\d(K|M)\s/)[0].length)).size, 1);
});

test("按型号分开列累计：哪家的哪个型号、花费、token、次数、一般多久", () => {
  const text = renderUsage(report, plain);
  assert.match(text, /按型号/);
  assert.match(text, /Gemini gemini-3\.6-flash\s+\$1\.10\s+1\.2M\s+720 次\s+一般 1\.7 秒/);
  assert.match(text, /OpenAI gpt-audio-mini-2025-12-15\s+\$0\.14\s+200K\s+90 次\s+一般 2\.6 秒/);
});

test("说清 token 的分项、验证 key 的也算在里面、钱是按标准价估的", () => {
  const text = renderUsage(report, plain);
  assert.match(text, /输入 1\.38M（其中音频 120K、命中缓存 0），输出 20K（其中思考 0）/);
  assert.match(text, /验证 key 的 14 次也算在里面/);
  assert.match(text, /官方标准价/);
  assert.match(text, /免费额度/);
});

test("今天还没说过话：那一行是 0，等待时间写一道横线", () => {
  const text = lines(renderUsage({ ...report, today: period() }, plain));
  assert.match(
    text.find((line) => line.startsWith("  今天")),
    /今天\s+\$0\s+0\s+0\s+—$/,
  );
});

test("有的型号不在价目表里：说出是哪几个，它们的钱没算进去", () => {
  const unknown = {
    ...report,
    total: { ...report.total, unpricedCalls: 3 },
    models: [
      ...report.models,
      {
        provider: "gemini",
        model: "gemini-9-ultra",
        ...period({ calls: 3, dictations: 3, unpricedCalls: 3, tokens: 4000 }),
      },
    ],
  };
  const text = renderUsage(unknown, plain);
  assert.match(text, /gemini-9-ultra\s+价格不明/);
  assert.match(text, /gemini-9-ultra 不在价目表里，这 3 次的钱没算进去/);
});

test("还没有用量记录时说一句", () => {
  for (const empty of [null, { today: period(), month: period(), total: period(), models: [] }]) {
    assert.match(renderUsage(empty, plain), /还没有用量记录/);
  }
});
