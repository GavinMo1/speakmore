import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { planCosts } from "../../src/usage/plan-costs.mjs";

test("官网费用一段写的月成本和 App 推荐组合算的一样：价目改了要在 website/ 下重跑 npm run plan-costs", async () => {
  const written = JSON.parse(readFileSync(new URL("../../website/src/costs.json", import.meta.url), "utf8"));
  assert.deepEqual(written, await planCosts());
});

test("两个方案：付费的每月几块钱，纯本机的一分不花", async () => {
  const { paid, free } = await planCosts();
  assert.ok(paid.cny > 0 && paid.cny < 10, `付费方案每月 ¥${paid.cny}`);
  assert.deepEqual(free, { usd: 0, cny: 0 });
});
