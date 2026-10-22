import assert from "node:assert/strict";
import { test } from "node:test";
import { placeCard } from "../../../src/app/lookup/place.mjs";

const workArea = { x: 0, y: 25, width: 1440, height: 875 };
const size = { width: 384, height: 160 };

test("放在选区下方、左边对齐选区，空一点距离", () => {
  const selection = { x: 240, y: 352, width: 560, height: 56 };
  assert.deepEqual(placeCard({ selection, pointer: null, size, workArea }), { x: 240, y: 416, above: false });
});

test("下方放不下就翻到选区上方", () => {
  const selection = { x: 240, y: 760, width: 300, height: 20 };
  assert.deepEqual(placeCard({ selection, pointer: null, size, workArea }), { x: 240, y: 760 - 8 - 160, above: true });
});

test("左右不出屏幕：靠右的选区往左挪，留出边距", () => {
  const selection = { x: 1300, y: 300, width: 100, height: 20 };
  assert.equal(placeCard({ selection, pointer: null, size, workArea }).x, 1440 - 384 - 8);
  const left = { x: -40, y: 300, width: 100, height: 20 };
  assert.equal(placeCard({ selection: left, pointer: null, size, workArea }).x, 8);
});

test("上下都放不下（选区占了大半个屏）：贴着可用区域的底边放，不出屏幕", () => {
  const selection = { x: 100, y: 100, width: 800, height: 700 };
  assert.deepEqual(placeCard({ selection, pointer: null, size, workArea }), {
    x: 100,
    y: 25 + 875 - 8 - 160,
    above: false,
  });
});

test("拿不到选区位置（模拟复制取的字）：放在鼠标下方", () => {
  assert.deepEqual(placeCard({ selection: null, pointer: { x: 500, y: 400 }, size, workArea }), {
    x: 500,
    y: 400 + 20,
    above: false,
  });
});

test("已经翻到上方的，卡片变高时还在上方、底边不动；没翻的变高放不下才翻", () => {
  const selection = { x: 240, y: 600, width: 300, height: 20 };
  const small = placeCard({ selection, pointer: null, size: { width: 384, height: 120 }, workArea });
  assert.equal(small.above, false);
  const tall = placeCard({ selection, pointer: null, size: { width: 384, height: 320 }, workArea });
  assert.deepEqual(tall, { x: 240, y: 600 - 8 - 320, above: true });
});
