import assert from "node:assert/strict";
import { test } from "node:test";
import { createPendingSwitch } from "../../src/app/pending-switch.mjs";

const QWEN = "qwen3-asr-0.6b-q8";
const WAY = { mode: "private", changes: { privateTranscriber: QWEN }, model: QWEN };

function harness({ result = { ok: true }, fail = null } = {}) {
  const installed = new Set();
  const switched = [];
  const logged = [];
  const pending = createPendingSwitch({
    isInstalled: (id) => installed.has(id),
    switchMode: async (mode, changes) => {
      switched.push({ mode, changes });
      if (fail) throw fail;
      return result;
    },
    log: {
      info: (event) => logged.push(event),
      warn: (event) => logged.push(event),
      error: (event) => logged.push(event),
    },
  });
  return { pending, installed, switched, logged };
}

test("等的模型下好了才切过去，只切一次", async () => {
  const { pending, installed, switched, logged } = harness();
  pending.set(WAY);
  await pending.check();
  assert.deepEqual(switched, []);
  installed.add(QWEN);
  await pending.check();
  await pending.check();
  assert.deepEqual(switched, [{ mode: "private", changes: { privateTranscriber: QWEN } }]);
  assert.ok(logged.includes("pending_switch_done"));
});

test("不等了、用户自己换了：下好了也不切", async () => {
  const { pending, installed, switched } = harness();
  pending.set(WAY);
  pending.set(null);
  installed.add(QWEN);
  await pending.check();
  pending.set(WAY);
  pending.cancel();
  await pending.check();
  assert.deepEqual(switched, []);
});

test("切的时候没通过（比如 key 被拒）：记一笔，不再重试", async () => {
  const { pending, installed, switched, logged } = harness({ result: { ok: false, problem: "rejected" } });
  installed.add(QWEN);
  pending.set({ mode: "local", changes: { transcriber: QWEN }, model: QWEN });
  await pending.check();
  await pending.check();
  assert.equal(switched.length, 1);
  assert.ok(logged.includes("pending_switch_failed"));
});

test("切的时候抛了错：记进日志，不往外抛", async () => {
  const { pending, installed, logged } = harness({ fail: new Error("boom") });
  installed.add(QWEN);
  pending.set(WAY);
  await pending.check();
  assert.ok(logged.includes("pending_switch_failed"));
});

test("页面传来的写得不对：不认", () => {
  const { pending } = harness();
  assert.throws(() => pending.set({ ...WAY, mode: "cloud" }), TypeError);
  assert.throws(() => pending.set({ ...WAY, model: "no-such-model" }), TypeError);
  assert.throws(() => pending.set({ ...WAY, changes: { privateTranscriber: 1 } }), TypeError);
  assert.throws(() => pending.set({ mode: "private", model: QWEN }), TypeError);
  assert.throws(() => pending.set("private"), TypeError);
});
