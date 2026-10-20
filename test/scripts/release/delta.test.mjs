import assert from "node:assert/strict";
import { test } from "node:test";
import { compareReleases, LIMIT_BYTES } from "../../../scripts/release/delta.mjs";

// 发版前和线上比（scripts/release/delta.mjs）：块用短名字代替 sha256，每块压过以后的大小在 SIZES 里

const SIZES = { m1: 1000, m2: 1000, m3: 1000, a: 5_000_000, b: 5_000_000, c: 30_000_000, d: 2_000 };
const MANIFESTS = {
  m1: new Map([
    ["a", 1],
    ["b", 1],
  ]),
  m2: new Map([
    ["a", 1],
    ["d", 1],
  ]),
};
const channel = (version, electron, targets) => ({ version, electron, targets });
const compare = (local, live, manifests = MANIFESTS) =>
  compareReleases({
    local,
    live,
    localChunks: (_target, sha) => manifests[sha],
    liveChunks: (_target, sha) => manifests[sha] ?? null,
    packedSize: (sha) => SIZES[sha],
  });

test("要下的是本机缺的块加上清单本身；上一版没有的装法整个下", () => {
  const report = compare(
    channel("1.1.0", "44.0.0", { "darwin-arm64": "m2", "win32-x64": "m2" }),
    channel("1.0.0", "44.0.0", { "darwin-arm64": "m1" }),
  );
  assert.deepEqual(report.rows, [
    { target: "darwin-arm64", bytes: SIZES.m2 + SIZES.d, chunks: 1, fresh: false },
    { target: "win32-x64", bytes: SIZES.m2 + SIZES.a + SIZES.d, chunks: 2, fresh: true },
  ]);
  assert.deepEqual(report.tooBig, [], "上一版没有的装法不算超");
  assert.equal(report.refuse, null);
});

test("Electron 没换、却要下 20 MB 以上：报出来；换了 Electron 的不拦", () => {
  const big = { ...MANIFESTS, m3: new Map([["c", 1]]) };
  const local = channel("1.1.0", "44.0.0", { "darwin-arm64": "m3" });
  assert.ok(SIZES.c > LIMIT_BYTES);
  assert.deepEqual(compare(local, channel("1.0.0", "44.0.0", { "darwin-arm64": "m1" }), big).tooBig, ["darwin-arm64"]);
  assert.deepEqual(compare(local, channel("1.0.0", "43.0.0", { "darwin-arm64": "m1" }), big).tooBig, []);
});

test("版本号往回退、同一个版本号内容却不一样：不许发；同一个版本、同样的内容（重跑）可以", () => {
  const live = channel("1.1.0", "44.0.0", { "darwin-arm64": "m2" });
  assert.match(compare(channel("1.0.9", "44.0.0", { "darwin-arm64": "m1" }), live).refuse, /比下载地址上的 1\.1\.0 旧/);
  assert.match(compare(channel("1.1.0", "44.0.0", { "darwin-arm64": "m1" }), live).refuse, /发布过的版本不改/);
  assert.equal(compare(channel("1.1.0", "44.0.0", { "darwin-arm64": "m2" }), live).refuse, null);
  // 预发版比同号的正式版旧
  assert.match(compare(channel("1.1.0-rc.1", "44.0.0", { "darwin-arm64": "m2" }), live).refuse, /旧/);
});
