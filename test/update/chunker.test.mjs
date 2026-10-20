import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { CHUNKING, chunksOf, cutPoints } from "../../src/update/chunker.mjs";

/** 固定种子的伪随机内容：每次跑都一样，测试不会时好时坏 */
function pseudoRandom(size, seed = 1) {
  const data = Buffer.alloc(size);
  let x = seed;
  for (let i = 0; i < size; i += 1) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    data[i] = x >>> 24;
  }
  return data;
}

test("切出来的块首尾相接、正好盖满整段内容，每块在最小和最大长度之间（最后一块可以更短）", () => {
  const data = pseudoRandom(5 * 1024 * 1024);
  const chunks = cutPoints(data);
  let next = 0;
  for (const [i, { offset, size }] of chunks.entries()) {
    assert.equal(offset, next);
    assert.ok(size <= CHUNKING.max, `第 ${i} 块 ${size} 字节`);
    if (i < chunks.length - 1) assert.ok(size >= CHUNKING.min, `第 ${i} 块 ${size} 字节`);
    next += size;
  }
  assert.equal(next, data.length);
  // 平均长度大致对得上（切点由内容决定，只看量级）
  const average = data.length / chunks.length;
  assert.ok(average > CHUNKING.avg / 2 && average < CHUNKING.avg * 2, `平均 ${average}`);
});

test("同样的内容切法永远一样：发布时和更新时切出同样的块", () => {
  const data = pseudoRandom(2 * 1024 * 1024, 7);
  assert.deepEqual(chunksOf(data), chunksOf(Buffer.from(data)));
});

test("中间插进一段：只有插入处附近的块变了，前后的块都还认得出来", () => {
  const data = pseudoRandom(4 * 1024 * 1024, 3);
  const edited = Buffer.concat([data.subarray(0, 2_000_000), randomBytes(1000), data.subarray(2_000_000)]);
  const before = new Set(chunksOf(data).map((chunk) => chunk.sha256));
  const after = chunksOf(edited);
  const fresh = after.filter((chunk) => !before.has(chunk.sha256));
  const freshBytes = fresh.reduce((sum, chunk) => sum + chunk.size, 0);
  assert.ok(fresh.length <= 3, `变了 ${fresh.length} 块`);
  assert.ok(freshBytes < 3 * CHUNKING.max, `变了 ${freshBytes} 字节`);
});

test("小文件和空文件各是一块", () => {
  assert.deepEqual(cutPoints(Buffer.from("hello")), [{ offset: 0, size: 5 }]);
  assert.deepEqual(cutPoints(Buffer.alloc(0)), [{ offset: 0, size: 0 }]);
  assert.equal(chunksOf(Buffer.alloc(0))[0].sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});
