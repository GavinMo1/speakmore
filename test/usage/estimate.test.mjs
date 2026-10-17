import assert from "node:assert/strict";
import { test } from "node:test";
import { costPerDictation, estimateTime, MONTHLY_DICTATIONS, monthlyCost, TYPICAL } from "../../src/usage/estimate.mjs";

// 每月成本的口径：每天 100 次、一个月 30 天，一次按典型口述的用量，价交给各家的价目模块（这里换成假的）。

/** 假的查价：记下问了谁、用的什么用量，按角色回一个固定的价 */
function fakeCosts(prices) {
  const asked = [];
  const costOf = (role, vendor, model, usage, at) => {
    asked.push({ role, vendor, model, usage, at });
    return prices[`${role} ${vendor}/${model}`] ?? null;
  };
  return { asked, costOf };
}

const AT = new Date("2026-10-19T02:30:00Z");

test("口径：每天 100 次、一个月 30 天", () => {
  assert.equal(MONTHLY_DICTATIONS, 3000);
});

test("本机转写加云端润色：转写不花钱，只算润色那一次，用的是那一家的典型用量", () => {
  const { asked, costOf } = fakeCosts({ "polish deepseek/deepseek-flash": 0.00004 });
  const route = {
    mode: "local",
    transcriber: "qwen3-asr-0.6b-q8",
    polish: { vendor: "deepseek", model: "deepseek-flash" },
  };
  assert.equal(costPerDictation(route, costOf, AT), 0.00004);
  assert.deepEqual(asked, [
    { role: "polish", vendor: "deepseek", model: "deepseek-flash", usage: TYPICAL.polish.deepseek, at: AT },
  ]);
  assert.equal(Math.round(monthlyCost(route, costOf, AT) * 1000) / 1000, 0.12);
});

test("第一跳交给云端：转写按典型时长算一笔，润色再算一笔，两笔相加", () => {
  const { asked, costOf } = fakeCosts({
    "transcribe bailian/qwen3-asr-flash": 0.0008,
    "polish bailian/deepseek-v4.1-flash": 0.0001,
  });
  const route = {
    mode: "local",
    transcriber: "bailian/qwen3-asr-flash",
    polish: { vendor: "bailian", model: "deepseek-v4.1-flash" },
  };
  assert.equal(Math.round(costPerDictation(route, costOf, AT) * 1e6) / 1e6, 0.0009);
  assert.equal(asked[0].usage.seconds, TYPICAL.seconds);
});

test("原生：用那一家自己写法的典型用量；数据隐私不花钱，也不查价", () => {
  const { asked, costOf } = fakeCosts({ "native gemini/gemini-3.6-flash": 0.0005 });
  const native = { mode: "native", model: { provider: "gemini", model: "gemini-3.6-flash" } };
  assert.equal(costPerDictation(native, costOf, AT), 0.0005);
  assert.equal(asked[0].usage, TYPICAL.native.gemini);

  const quiet = fakeCosts({});
  assert.equal(monthlyCost({ mode: "private", transcriber: "qwen3-asr-0.6b-q8" }, quiet.costOf, AT), 0);
  assert.equal(quiet.asked.length, 0);
});

test("算不出来就是 null，不编：没量过那一家的用量、价目里没有、自定义服务", () => {
  const { costOf } = fakeCosts({ "polish moonshot/kimi-k2.6": 0.001 });
  const local = (polish) => ({ mode: "local", transcriber: "qwen3-asr-0.6b-q8", polish });
  assert.equal(costPerDictation(local({ vendor: "moonshot", model: "kimi-k2.6" }), costOf, AT), null, "没量过 Kimi");
  assert.equal(
    costPerDictation(local({ vendor: "deepseek", model: "deepseek-flash" }), costOf, AT),
    null,
    "价目里没有",
  );
  assert.equal(costPerDictation(local({ vendor: "custom", model: "x" }), costOf, AT), null, "自定义服务没有价");
  assert.equal(monthlyCost(local({ vendor: "custom", model: "x" }), costOf, AT), null);
});

test("估价的时刻是工作日的高峰（北京时间上午十点半）：周末往后挪到周一，同一天里算出来的数不跟着钟点变", () => {
  // 2026-10-17 是周六
  assert.equal(estimateTime(new Date("2026-10-17T15:00:00Z")).toISOString(), "2026-10-19T02:30:00.000Z");
  assert.equal(estimateTime(new Date("2026-10-19T23:59:00Z")).toISOString(), "2026-10-19T02:30:00.000Z");
  assert.equal(estimateTime(new Date("2026-10-20T00:01:00Z")).toISOString(), "2026-10-20T02:30:00.000Z");
});
