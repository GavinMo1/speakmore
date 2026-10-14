import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSeconds, formatTokens, formatUsd } from "../../src/usage/format.mjs";

test("token 数按千、百万、十亿缩写成 K、M、B，留三位有效数字", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1000), "1K");
  assert.equal(formatTokens(1394), "1.39K");
  assert.equal(formatTokens(21_300), "21.3K");
  assert.equal(formatTokens(350_400), "350K");
  // 进位到下一档时不写成 1000K
  assert.equal(formatTokens(999_600), "1M");
  assert.equal(formatTokens(6_020_000), "6.02M");
  assert.equal(formatTokens(1_250_000_000), "1.25B");
  assert.equal(formatTokens(3_000_000_000_000), "3000B");
});

test("钱：一次听写那种零点几分的留两位有效数字，一块钱以上到分；太小的说不到万分之一", () => {
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.0000015), "<$0.0001");
  assert.equal(formatUsd(0.0010575), "$0.0011");
  assert.equal(formatUsd(0.013), "$0.013");
  assert.equal(formatUsd(0.5), "$0.50");
  // 快到一块钱时不写成 $1.0
  assert.equal(formatUsd(0.998), "$1.00");
  assert.equal(formatUsd(12.346), "$12.35");
});

test("等待时间写成秒，一位小数", () => {
  assert.equal(formatSeconds(1700), "1.7 秒");
  assert.equal(formatSeconds(640), "0.6 秒");
  assert.equal(formatSeconds(12_000), "12.0 秒");
});
