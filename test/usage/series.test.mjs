import assert from "node:assert/strict";
import { test } from "node:test";
import { modelKey, spanSeries, timeSeries } from "../../src/usage/series.mjs";

const row = (slot, costUsd, provider = "gemini", model = "gemini-3.6-flash") => ({ slot, provider, model, costUsd });
/** 本机时间的那一刻，写成报表里的样子 */
const iso = (...parts) => new Date(...parts).toISOString();
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≠ ${expected}`);

test("型号的键：哪家加型号；型号里带斜杠也分得开", () => {
  assert.equal(modelKey({ provider: "openrouter", model: "qwen/qwen3" }), "openrouter/qwen/qwen3");
});

test("今天按钟头：0 点到 23 点二十四格，还没到的钟头标出来，每格按型号分开加", () => {
  const now = new Date(2026, 9, 14, 15, 30);
  const series = timeSeries(
    [
      row("2026-10-14 09", 0.001),
      row("2026-10-14 09", 0.002, "deepseek", "deepseek-flash"),
      row("2026-10-14 15", 0.004),
    ],
    { unit: "hour", from: new Date(2026, 9, 14), to: new Date(2026, 9, 14, 23), now },
  );
  assert.equal(series.unit, "hour");
  assert.equal(series.buckets.length, 24);
  assert.equal(series.buckets[0].start, iso(2026, 9, 14, 0));
  const nine = series.buckets[9];
  close(nine.costUsd, 0.003);
  assert.deepEqual(Object.keys(nine.models).sort(), ["deepseek/deepseek-flash", "gemini/gemini-3.6-flash"]);
  close(nine.models["deepseek/deepseek-flash"], 0.002);
  // 现在这个钟头算已经到了，下一个钟头起是还没到的
  assert.deepEqual(
    series.buckets.map(({ future }) => future),
    Array.from({ length: 24 }, (_, hour) => hour > 15),
  );
  assert.deepEqual(series.buckets[3], { start: iso(2026, 9, 14, 3), costUsd: 0, models: {}, future: false });
});

test("本月按天：1 号到月底，范围外的行不算进来", () => {
  const now = new Date(2026, 9, 14, 15, 30);
  const series = timeSeries([row("2026-09-30", 9), row("2026-10-01", 0.001), row("2026-10-14", 0.002)], {
    unit: "day",
    from: new Date(2026, 9, 1),
    to: new Date(2026, 9, 31),
    now,
  });
  assert.equal(series.buckets.length, 31);
  assert.equal(series.buckets[0].costUsd, 0.001);
  assert.equal(series.buckets[13].costUsd, 0.002);
  assert.equal(series.buckets[13].future, false);
  assert.equal(series.buckets[14].future, true);
  close(
    series.buckets.reduce((sum, { costUsd }) => sum + costUsd, 0),
    0.003,
  );
});

test("累计：用了不到三个月按天画，至少画最近 30 天", () => {
  const now = new Date(2026, 9, 14, 15, 30);
  const short = spanSeries([row("2026-10-10", 0.001)], { now });
  assert.equal(short.unit, "day");
  assert.equal(short.buckets.length, 30);
  assert.equal(short.buckets.at(-1).start, iso(2026, 9, 14));
  assert.equal(short.buckets.at(-5).costUsd, 0.001);

  const longer = spanSeries([row("2026-08-01", 0.001), row("2026-10-14", 0.002)], { now });
  assert.equal(longer.unit, "day");
  assert.equal(longer.buckets[0].start, iso(2026, 7, 1));
  assert.equal(longer.buckets.length, 75);

  // 一笔都没有：照样是最近 30 天，全是 0
  const empty = spanSeries([], { now });
  assert.equal(empty.unit, "day");
  assert.equal(empty.buckets.length, 30);
  assert.ok(empty.buckets.every(({ costUsd }) => costUsd === 0));
});

test("累计：用了三个月以上按周（周一起），两年以上按月", () => {
  const now = new Date(2026, 9, 14, 15, 30);
  // 2026-06-03 是星期三：所在那一周从 6 月 1 日（周一）起
  const weekly = spanSeries([row("2026-06-03", 0.001), row("2026-06-07", 0.002), row("2026-10-12", 0.004)], { now });
  assert.equal(weekly.unit, "week");
  assert.equal(weekly.buckets[0].start, iso(2026, 5, 1));
  close(weekly.buckets[0].costUsd, 0.003);
  // 10 月 12 日（周一）那一周是最后一格，今天在里面
  assert.equal(weekly.buckets.at(-1).start, iso(2026, 9, 12));
  assert.equal(weekly.buckets.at(-1).costUsd, 0.004);
  assert.ok(weekly.buckets.every(({ future }) => !future));

  const monthly = spanSeries([row("2024-03-15", 0.001), row("2026-10-01", 0.002)], { now });
  assert.equal(monthly.unit, "month");
  assert.equal(monthly.buckets[0].start, iso(2024, 2, 1));
  assert.equal(monthly.buckets.length, 32);
  assert.equal(monthly.buckets.at(-1).costUsd, 0.002);
});
