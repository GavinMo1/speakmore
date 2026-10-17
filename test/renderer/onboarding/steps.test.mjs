import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstStepOf,
  GROUPS,
  groupStates,
  STEPS,
  startStep,
  stepDone,
} from "../../../src/renderer/onboarding/steps.mjs";

const QWEN = "qwen3-asr-0.6b-q8";

const setup = ({ mode = "native", key = "missing", installed = false, switchable = true, permissions = {} } = {}) => ({
  mode: { value: mode },
  native: { model: "gemini/gemini-3.6-flash", providers: [{ id: "gemini", key: null }] },
  local: {
    transcriber: QWEN,
    polish: "deepseek/deepseek-flash",
    transcribers: [{ id: QWEN, installed, download: null }],
    vendors: [{ id: "deepseek", key: null }],
  },
  private: { transcriber: QWEN },
  plaza: { presets: [] },
  provider: mode === "private" ? null : { id: "gemini" },
  key: { state: key },
  switchable,
  permissions: { microphone: "granted", listen: true, trusted: true, ...permissions },
});

test("引导的顺序：选用法、准备模型、权限、测麦克风、测快捷键、体验一下、完成", () => {
  assert.deepEqual(STEPS, ["way", "prepare", "permissions", "microphone", "hotkey", "try", "done"]);
});

test("从哪一步开始：现在用的那套还不能用就从选用法开始；能用了从权限开始", () => {
  assert.equal(startStep(setup()), "way");
  assert.equal(startStep(setup({ key: "rejected" })), "way");
  assert.equal(startStep(setup({ key: "ready" })), "permissions");
  // 正在验证的不让人再填一遍
  assert.equal(startStep(setup({ key: "checking" })), "permissions");
  assert.equal(startStep(setup({ mode: "private" })), "way");
  assert.equal(startStep(setup({ mode: "private", installed: true })), "permissions");
  // 连着单独启动的服务端：用哪种由那边定
  assert.equal(startStep(setup({ switchable: false })), "permissions");
});

test("每一步做完了没有：没做完的写跳过，照样能往下走", () => {
  const state = (extra = {}) => ({ setup: setup(), said: false, ...extra });
  assert.equal(stepDone("way", state()), true);
  assert.equal(stepDone("prepare", state()), false);
  assert.equal(stepDone("prepare", state({ setup: setup({ key: "ready" }) })), true);
  assert.equal(stepDone("permissions", state()), true);
  assert.equal(stepDone("permissions", state({ setup: setup({ permissions: { listen: false } }) })), false);
  assert.equal(stepDone("permissions", state({ setup: setup({ permissions: { microphone: "denied" } }) })), false);
  // 辅助功能可以以后再给
  assert.equal(stepDone("permissions", state({ setup: setup({ permissions: { trusted: false } }) })), true);
  // 测麦克风、测快捷键靠那一步自己的"是的，继续"
  assert.equal(stepDone("microphone", state()), false);
  assert.equal(stepDone("hotkey", state()), false);
  assert.equal(stepDone("try", state()), false);
  assert.equal(stepDone("try", state({ said: true })), true);
});

test("顶上三段：点哪段去哪段的第一步；做完的、正在做的、还没到的", () => {
  assert.deepEqual(GROUPS, ["model", "setup", "try"]);
  assert.deepEqual(GROUPS.map(firstStepOf), ["way", "permissions", "try"]);
  assert.deepEqual(groupStates("prepare"), { model: "current", setup: "todo", try: "todo" });
  assert.deepEqual(groupStates("hotkey"), { model: "done", setup: "current", try: "todo" });
  assert.deepEqual(groupStates("done"), { model: "done", setup: "done", try: "current" });
});
