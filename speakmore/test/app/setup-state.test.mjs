import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeSetup } from "../../src/app/setup-state.mjs";

const allGood = {
  key: { state: "ready", source: "stored", problem: null },
  permissions: { microphone: "granted", listen: true, trusted: true },
};
const withKey = (key) => ({ ...allGood, key: { source: null, problem: null, ...key } });
const withPermissions = (permissions) => ({ ...allGood, permissions: { ...allGood.permissions, ...permissions } });

test("都齐了：可以用，没有要补的", () => {
  assert.deepEqual(summarizeSetup(allGood), { ready: true, missing: [], blocker: null, degraded: null });
});

test("没有 key、key 解不开：不能用，提示去设置里填", () => {
  for (const state of ["missing", "unreadable"]) {
    const summary = summarizeSetup(withKey({ state }));
    assert.equal(summary.ready, false);
    assert.deepEqual(summary.missing, ["Gemini API key"]);
    assert.match(summary.blocker, /设置/);
  }
});

test("key 验证没通过：把原因带给用户", () => {
  const summary = summarizeSetup(withKey({ state: "rejected", problem: "这把 key 无效" }));
  assert.equal(summary.ready, false);
  assert.match(summary.blocker, /这把 key 无效/);
});

test("Gemini 拒绝了请求（模型名或档位写错）：不说成是 key 的问题", () => {
  const summary = summarizeSetup(
    withKey({ state: "rejected", cause: "other", problem: "Gemini 拒绝了请求：models/x is not found" }),
  );
  assert.equal(summary.ready, false);
  assert.deepEqual(summary.missing, ["Gemini 验证"]);
  assert.match(summary.blocker, /^Gemini 验证没通过：.*models\/x is not found/);
});

test("启动时没连上网、先用着的 key：算可以用", () => {
  assert.equal(summarizeSetup(withKey({ state: "ready", source: "stored", verified: false })).ready, true);
});

test("key 还在验证：不能用，但不算缺东西", () => {
  const summary = summarizeSetup(withKey({ state: "checking" }));
  assert.equal(summary.ready, false);
  assert.deepEqual(summary.missing, []);
  assert.match(summary.blocker, /稍等/);
});

test("麦克风或输入监控没授权：列进要补的", () => {
  assert.deepEqual(summarizeSetup(withPermissions({ microphone: "denied" })).missing, ["麦克风权限"]);
  assert.deepEqual(summarizeSetup(withPermissions({ listen: false })).missing, ["输入监控权限"]);
  assert.deepEqual(
    summarizeSetup(withKey({ state: "missing" })).missing.concat(
      summarizeSetup(withPermissions({ microphone: "denied", listen: false })).missing,
    ),
    ["Gemini API key", "麦克风权限", "输入监控权限"],
  );
});

test("按键监听还没启动好：暂时不能用，但不算缺权限", () => {
  const summary = summarizeSetup(withPermissions({ listen: null, trusted: null }));
  assert.equal(summary.ready, false);
  assert.deepEqual(summary.missing, []);
});

test("只缺辅助功能：照样能用，只是要自己按粘贴", () => {
  const summary = summarizeSetup(withPermissions({ trusted: false }));
  assert.equal(summary.ready, true);
  assert.deepEqual(summary.missing, []);
  assert.match(summary.degraded, /剪贴板/);
});

test("按键监听的小程序停了：不再说成“正在准备”，明说缺它", () => {
  const summary = summarizeSetup({ ...withPermissions({ listen: null, trusted: null }), helper: "stopped" });
  assert.equal(summary.ready, false);
  assert.deepEqual(summary.missing, ["按键监听"]);
});
