import assert from "node:assert/strict";
import { test } from "node:test";
import { percentile, usageReport } from "../../src/usage/report.mjs";

const totals = (overrides = {}) => ({
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
  latenciesMs: [],
  ...overrides,
});

/** 假的历史库：记下问的是哪个时刻之后的，按时刻给不同的汇总 */
function fakeHistory(bySince) {
  const asked = [];
  return {
    asked,
    usage({ since = "" } = {}) {
      asked.push(since);
      return bySince[since] ?? { ...totals(), models: [] };
    },
  };
}

test("分位数：从快到慢排好的一串里取，最近秩法；空的是 null", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([1700], 0.9), 1700);
  assert.equal(percentile([1000, 2000, 3000, 4000], 0.5), 2000);
  const tenth = Array.from({ length: 10 }, (_, i) => (i + 1) * 100);
  assert.equal(percentile(tenth, 0.9), 900);
  assert.equal(percentile(tenth, 0.5), 500);
});

test("今天从本机时区的零点算，本月从 1 号零点算，累计不限", () => {
  const history = fakeHistory({});
  usageReport(history, { now: new Date(2026, 9, 14, 15, 30) });
  assert.deepEqual(
    history.asked.sort(),
    ["", new Date(2026, 9, 1).toISOString(), new Date(2026, 9, 14).toISOString()].sort(),
  );
});

test("每段给出 token 合计和模型一般多久回话（中位数）、慢的时候多久（九成都比它快）；按型号分开的是累计的", () => {
  const all = {
    ...totals({
      calls: 12,
      checks: 2,
      dictations: 10,
      inputTokens: 15_000,
      audioTokens: 2_500,
      outputTokens: 400,
      costUsd: 0.012,
      latenciesMs: [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 5000],
    }),
    models: [
      {
        provider: "gemini",
        model: "gemini-3.6-flash",
        ...totals({ calls: 12, dictations: 10, costUsd: 0.012, latenciesMs: [1000, 5000] }),
      },
    ],
  };
  const report = usageReport(fakeHistory({ "": all }), { now: new Date(2026, 9, 14, 15, 30) });

  const { latenciesMs: _raw, models: _models, ...expectedTotals } = all;
  assert.deepEqual(report.total, {
    ...expectedTotals,
    tokens: 15_400,
    latency: { medianMs: 1400, p90Ms: 1800 },
  });
  // 今天还没调过：等待时间说不出来是 null，不是 0 秒
  assert.equal(report.today.calls, 0);
  assert.equal(report.today.latency, null);
  assert.deepEqual(
    report.models.map(({ provider, model, latency, latenciesMs }) => ({ provider, model, latency, latenciesMs })),
    [
      {
        provider: "gemini",
        model: "gemini-3.6-flash",
        latency: { medianMs: 1000, p90Ms: 5000 },
        latenciesMs: undefined,
      },
    ],
  );
});
