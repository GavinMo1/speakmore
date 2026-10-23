import assert from "node:assert/strict";
import { test } from "node:test";
import { engineReady, FEATURES, permissionsOff, stepDone, stepsFor } from "../../../src/renderer/onboarding/flow.mjs";

const setup = (overrides = {}) => ({
  key: { state: "ready" },
  localModel: null,
  permissions: { microphone: "granted", listen: true, trusted: true },
  ...overrides,
});

test("Mac 多一步权限，Windows 没有；开屏总在最前、引擎总在最后", () => {
  assert.deepEqual(stepsFor("darwin"), ["splash", "features", "keys", "permissions", "engine"]);
  assert.deepEqual(stepsFor("win32"), ["splash", "features", "keys", "engine"]);
});

test("三个功能按语音输入、语音翻译、划词翻译排", () => {
  assert.deepEqual(FEATURES, ["dictate", "translate", "lookup"]);
});

test("快捷键三个都按到了才算做完", () => {
  const ctx = (ids) => ({ passed: new Set(ids), setup: setup() });
  assert.equal(stepDone("keys", ctx(["dictate", "translate"])), false);
  assert.equal(stepDone("keys", ctx(["dictate", "translate", "lookup"])), true);
});

test("权限三项都开了才算做完；还在查的（null）不算开了", () => {
  const ctx = (permissions) => ({ passed: new Set(), setup: setup({ permissions }) });
  assert.equal(stepDone("permissions", ctx({ microphone: "granted", listen: true, trusted: true })), true);
  assert.equal(stepDone("permissions", ctx({ microphone: "denied", listen: true, trusted: true })), false);
  assert.equal(stepDone("permissions", ctx({ microphone: "granted", listen: null, trusted: true })), false);
  assert.equal(
    permissionsOff(setup({ permissions: { microphone: "not-determined", listen: false, trusted: true } })),
    2,
  );
});

test("开屏、功能、引擎没有要做完的", () => {
  for (const step of ["splash", "features", "engine"]) {
    assert.equal(stepDone(step, { passed: new Set(), setup: setup() }), true);
  }
});

test("引擎配好了：密钥能用（或这种方式不要密钥），要的本机模型也在", () => {
  assert.equal(engineReady(setup()), true);
  assert.equal(engineReady(setup({ key: { state: "checking" } })), true);
  assert.equal(engineReady(setup({ key: { state: "missing" } })), false);
  assert.equal(engineReady(setup({ key: { state: "rejected" } })), false);
  assert.equal(engineReady(setup({ localModel: { state: "missing" } })), false);
  assert.equal(engineReady(setup({ localModel: { state: "failed" } })), false);
  assert.equal(engineReady(setup({ localModel: { state: "loading" } })), true);
});
