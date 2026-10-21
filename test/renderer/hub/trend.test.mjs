import assert from "node:assert/strict";
import { test } from "node:test";
import { curvePath, smoothed, spreadFor } from "../../../src/renderer/hub/trend.mjs";

const close = (actual, expected, within = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < within, `${actual} ≠ ${expected}`);

test("平滑的宽窄跟着格子数走：格子总数的 1/16，至少 1 格", () => {
  assert.equal(spreadFor(8), 1);
  assert.equal(spreadFor(24), 1.5);
  assert.equal(spreadFor(80), 5);
});

test("平滑：一样高的还是一样高，两头也不往下掉", () => {
  const flat = smoothed([3, 3, 3, 3, 3, 3], 2);
  for (const value of flat) close(value, 3);
  assert.deepEqual(smoothed([], 2), []);
});

test("平滑：一根尖的摊到两边，左右对称、顶变矮，加起来的总量大致不变", () => {
  const values = Array.from({ length: 21 }, (_, index) => (index === 10 ? 10 : 0));
  const result = smoothed(values, 2);
  assert.ok(result[10] < 10 && result[10] > 0);
  for (let step = 1; step <= 10; step++) close(result[10 - step], result[10 + step]);
  assert.ok(result[9] < result[10] && result[8] < result[9]);
  close(
    result.reduce((sum, value) => sum + value, 0),
    10,
    // 挨着两头的格子按实际有的分量归一，总量会差一点点
    0.01,
  );
  // 摊得越宽越平
  assert.ok(smoothed(values, 4)[10] < result[10]);
});

/** 一段三次贝塞尔上 t 处的 y */
const bezierY = (y0, c0, c1, y1, t) =>
  (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * c0 + 3 * (1 - t) * t ** 2 * c1 + t ** 3 * y1;

test("曲线过每一个点；每一段只在两头之间，不冲过头（不会画到 0 以下）", () => {
  const points = [
    [0.5, 100],
    [1.5, 20],
    [2.5, 100],
    [3.5, 100],
    [4.5, 60],
    [5.5, 0],
  ];
  const path = curvePath(points);
  assert.match(path, /^M0\.5,100C/);
  const segments = [...path.matchAll(/C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/g)];
  assert.equal(segments.length, points.length - 1);
  segments.forEach((segment, index) => {
    const [, , c0, , c1, x1, y1] = segment.map(Number);
    const y0 = points[index][1];
    assert.deepEqual([x1, y1], points[index + 1]);
    const [low, high] = [Math.min(y0, y1), Math.max(y0, y1)];
    for (let t = 0; t <= 1; t += 0.05) {
      const y = bezierY(y0, c0, c1, y1, t);
      assert.ok(
        y >= low - 1e-6 && y <= high + 1e-6,
        `第 ${index + 1} 段在 t=${t.toFixed(2)} 处 ${y} 出了 [${low}, ${high}]`,
      );
    }
  });
});

test("曲线：没有点是空的，一个点只有起笔", () => {
  assert.equal(curvePath([]), "");
  assert.equal(curvePath([[0.5, 40]]), "M0.5,40");
});
