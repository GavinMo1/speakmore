import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeSetup } from "../../src/app/setup-state.mjs";
import { createTranslator } from "../../src/i18n/index.mjs";
import { boot, requests } from "./route-harness.mjs";

// 选哪种识别方式是用户的事，能不能用是状态：两件事分开（app/modes.mjs）。
// 以前切换前要先验 key、先下好模型，刚装好时（原生、没有 key、本机模型没下载）哪种都切不过去，人就卡死在原生里。
// 这里整套拼起来走一遍（./route-harness.mjs）：切换当场生效，还差什么记在状态里，补齐了自己就能用。

const zh = createTranslator("zh-CN");
/** 刚装好：设置里什么都没有（原生、Gemini），一把 key 都没存 */
const FRESH = {};
const QWEN = "qwen3-asr-0.6b-q8";

/** 等本机模型装好（假的装载是异步的） */
async function loaded(app) {
  for (let i = 0; i < 50 && app.service.localModel.state !== "ready"; i++) await new Promise((r) => setTimeout(r, 2));
  return app.service.localModel.state;
}

test("刚装好、本机模型没下载：切到数据隐私当场换上，状态说模型还没下载；下好了自己装上，能用", async (t) => {
  const installed = [];
  const app = await boot(t, { settings: FRESH, installed });
  await app.keys.loadAtStartup();
  assert.equal(app.keys.current.state, "missing", "起点：原生没有 Gemini 的 key");

  requests.length = 0;
  assert.equal((await app.modes.switchMode("private")).ok, true);
  assert.equal(app.service.route.mode, "private");
  assert.equal(app.saved().mode, "private");
  assert.deepEqual(requests, []);
  assert.deepEqual([app.keys.current.state, app.keys.current.source], ["ready", "none"]);
  assert.equal(app.service.localModel.state, "missing");

  installed.push(QWEN);
  app.service.modelsChanged();
  assert.equal(await loaded(app), "ready");
});

test("刚装好、没有 DeepSeek 的 key：切到转写 + 润色照样换上，状态点名缺 DeepSeek 的 key；存上就能用", async (t) => {
  const app = await boot(t, { settings: FRESH });
  await app.keys.loadAtStartup();
  assert.equal((await app.modes.switchMode("local")).ok, true);
  assert.equal(app.service.route.mode, "local");
  assert.equal(app.saved().mode, "local");
  assert.equal(app.keys.provider.id, "deepseek");
  assert.equal(app.keys.current.state, "missing");
  const summary = summarizeSetup({
    key: app.keys.current,
    permissions: { microphone: "granted", listen: true, trusted: true },
    providerName: "DeepSeek",
    localModel: app.service.localModel,
  });
  assert.match(zh.text(summary.blocker), /DeepSeek/);
  assert.doesNotMatch(zh.text(summary.blocker), /Gemini/);

  assert.deepEqual(await app.keys.save("ds-good"), { ok: true });
  assert.equal(app.keys.current.state, "ready");
});

test("没准备好的方式之间也能来回切：每次都按切到的那种说还差什么，不会卡在原来那种", async (t) => {
  const app = await boot(t, { settings: FRESH, installed: [] });
  await app.keys.loadAtStartup();
  assert.equal((await app.modes.switchMode("local")).ok, true);
  assert.equal((await app.modes.switchMode("private")).ok, true);
  assert.equal(app.keys.current.source, "none");
  assert.equal((await app.modes.switchMode("native")).ok, true);
  assert.equal(app.keys.provider.id, "gemini");
  assert.equal(app.keys.current.state, "missing");
});

test("换成还没有 key 的一家、还没下载的本机模型：照样换上，状态照实说", async (t) => {
  const app = await boot(t, {
    settings: { mode: "local", polish: "deepseek" },
    stored: { deepseek: "ds-good" },
    installed: [QWEN],
  });
  await app.keys.loadAtStartup();
  assert.equal(app.keys.current.state, "ready");

  assert.equal((await app.modes.setTranscriber("sensevoice-small-q8")).ok, true);
  assert.equal(app.saved().transcriber, "sensevoice-small-q8");
  assert.equal(app.service.localModel.state, "missing");
  assert.equal(app.keys.current.state, "ready", "只换第一跳的本机模型，润色那家的 key 照用");

  assert.equal((await app.modes.setPolish("moonshot")).ok, true);
  assert.equal(app.keys.provider.id, "moonshot");
  assert.equal(app.keys.current.state, "missing");
  assert.equal(app.saved().polish, "moonshot/kimi-k2.6");
});

test("换过去的那家 key 不对：照样换上，状态是没通过；换回原来那家又能用", async (t) => {
  const app = await boot(t, {
    settings: { mode: "local", polish: "deepseek" },
    stored: { deepseek: "ds-good", moonshot: "kimi-bad" },
  });
  await app.keys.loadAtStartup();
  assert.equal((await app.modes.setPolish("moonshot")).ok, true);
  assert.deepEqual([app.keys.current.state, app.keys.current.cause], ["rejected", "key"]);
  assert.equal((await app.modes.setPolish("deepseek")).ok, true);
  assert.equal(app.keys.current.state, "ready");
});
