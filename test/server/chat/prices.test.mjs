import assert from "node:assert/strict";
import { test } from "node:test";
import { costOf, isPeak } from "../../../src/server/chat/prices/deepseek.mjs";

const TOKENS = { input: 1_000_000, cached: 1_000_000, output: 1_000_000 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("高峰：周一到周五 UTC 01:00–04:00、06:00–10:00；其余时间和周末是低谷", () => {
  // 2026-10-16 是周五
  assert.equal(isPeak(new Date("2026-10-16T01:00:00Z")), true);
  assert.equal(isPeak(new Date("2026-10-16T03:59:59Z")), true);
  assert.equal(isPeak(new Date("2026-10-16T04:00:00Z")), false);
  assert.equal(isPeak(new Date("2026-10-16T05:30:00Z")), false);
  assert.equal(isPeak(new Date("2026-10-16T09:59:00Z")), true);
  assert.equal(isPeak(new Date("2026-10-16T10:00:00Z")), false);
  assert.equal(isPeak(new Date("2026-10-17T02:00:00Z")), false, "周六");
  assert.equal(isPeak(new Date("2026-10-18T02:00:00Z")), false, "周日");
});

test("按官方价目表算：未命中、命中缓存、输出各一个价，低谷是高峰的一半", () => {
  close(costOf("deepseek-flash", TOKENS, new Date("2026-10-16T02:00:00Z")), 0.3 + 0.006 + 1.2);
  close(costOf("deepseek-flash", TOKENS, new Date("2026-10-17T02:00:00Z")), 0.15 + 0.003 + 0.6);
  close(costOf("deepseek-v4-pro", TOKENS, new Date("2026-10-16T02:00:00Z")), 1.32 + 0.044 + 3.96);
});

test("旧名字按 Flash 的价算（官方说这些请求由 V4.1-Flash 处理、按 Flash 收费）；不认识的型号是空", () => {
  const at = new Date("2026-10-16T02:00:00Z");
  assert.equal(costOf("deepseek-v4-flash", TOKENS, at), costOf("deepseek-flash", TOKENS, at));
  assert.equal(costOf("deepseek-nope", TOKENS, at), null);
});

test("百炼：人民币价按汇率换成美元记；价目里没有的型号是空", async () => {
  const { costOf: bailianCost } = await import("../../../src/server/chat/prices/bailian.mjs");
  const { CNY_PER_USD } = await import("../../../src/server/currency.mjs");
  close(bailianCost("qwen3.8-flash", TOKENS), (0.8 + 0.1 + 2.7) / CNY_PER_USD);
  assert.equal(bailianCost("qwen3.7-plus", TOKENS), null);
});

test("Kimi：人民币价按汇率换成美元记；清单外的型号是空", async () => {
  const { costOf: kimiCost } = await import("../../../src/server/chat/prices/moonshot.mjs");
  const { CNY_PER_USD } = await import("../../../src/server/currency.mjs");
  close(kimiCost("kimi-k2.6", TOKENS), (6.5 + 1.1 + 27) / CNY_PER_USD);
  close(kimiCost("kimi-k3", TOKENS), (20 + 2 + 100) / CNY_PER_USD);
  assert.equal(kimiCost("kimi-k2.7-code", TOKENS), null);
});

test("智谱：免费的型号花费是 0；GLM-4.5-Air 按这一次输出的长度分两档；清单外的型号是空", async () => {
  const { costOf: zhipuCost } = await import("../../../src/server/chat/prices/zhipu.mjs");
  const { CNY_PER_USD } = await import("../../../src/server/currency.mjs");
  close(zhipuCost("glm-5.2", TOKENS), (8 + 2 + 28) / CNY_PER_USD);
  assert.equal(zhipuCost("glm-4.7-flash", TOKENS), 0);
  close(zhipuCost("glm-4.5-air", { input: 1_000_000, cached: 0, output: 199 }), (0.8 + (199 * 2) / 1e6) / CNY_PER_USD);
  close(zhipuCost("glm-4.5-air", { input: 1_000_000, cached: 0, output: 200 }), (0.8 + (200 * 6) / 1e6) / CNY_PER_USD);
  assert.equal(zhipuCost("glm-5.3", TOKENS), null);
});
