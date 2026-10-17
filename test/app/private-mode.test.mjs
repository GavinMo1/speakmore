import assert from "node:assert/strict";
import { test } from "node:test";
import { createTranslator } from "../../src/i18n/index.mjs";
import { boot, requests } from "./route-harness.mjs";

// 数据隐私模式（private）整套拼起来走一遍：只用本机模型转写，不要任何一家的 key，不往外发请求（./route-harness.mjs）。

const zh = createTranslator("zh-CN");
const PRIVATE = { mode: "private" };
const LOCAL = { mode: "local", polish: "deepseek" };

test("在数据隐私模式里启动：一把 key 都没有也能用，key 的状态是不用 key，一个请求都不发", async (t) => {
  requests.length = 0;
  const app = await boot(t, { settings: PRIVATE });
  const started = await app.keys.loadAtStartup();
  assert.equal(started.state, "ready");
  assert.equal(started.source, "none");
  assert.equal(app.service.ready, true);
  assert.equal(app.keys.provider, null);
  assert.deepEqual(requests, []);
});

test("切进切出数据隐私模式：切进去不问 key、不发请求；切回 local 照旧用润色那家的 key", async (t) => {
  const app = await boot(t, { settings: LOCAL, stored: { deepseek: "ds-good" } });
  await app.keys.loadAtStartup();
  requests.length = 0;
  assert.equal((await app.modes.switchMode("private")).ok, true);
  assert.deepEqual(requests, []);
  assert.equal(app.service.route.mode, "private");
  assert.equal(app.keys.current.source, "none");
  assert.equal(app.saved().mode, "private");

  assert.equal((await app.modes.switchMode("local")).ok, true);
  assert.equal(app.keys.current.state, "ready");
  assert.equal(app.keys.current.source, "stored");
  assert.equal(app.keys.provider.id, "deepseek");
});

test("切进数据隐私模式时它的本机模型还没下载：不切，说先下载哪个", async (t) => {
  const app = await boot(t, { settings: LOCAL, stored: { deepseek: "ds-good" }, installed: ["sensevoice-small-q8"] });
  await app.keys.loadAtStartup();
  const result = await app.modes.switchMode("private");
  assert.equal(result.ok, false);
  assert.match(zh.text(result.problem), /下载/);
  assert.equal(app.service.route.mode, "local");
});

test("数据隐私模式里换本机模型：存进它自己的那一项，local 的第一跳不动；云端的模型不收", async (t) => {
  const app = await boot(t, { settings: { ...PRIVATE, transcriber: "bailian/qwen3-asr-flash" } });
  await app.keys.loadAtStartup();
  assert.equal((await app.modes.setTranscriber("sensevoice-small-q8")).ok, true);
  assert.equal(app.service.route.transcriber, "sensevoice-small-q8");
  assert.equal(app.saved().privateTranscriber, "sensevoice-small-q8");
  assert.equal(app.saved().transcriber, "bailian/qwen3-asr-flash");

  const cloud = await app.modes.setTranscriber("bailian/qwen3-asr-flash");
  assert.equal(cloud.ok, false);
  assert.match(zh.text(cloud.problem), /数据隐私模式只用本机模型/);
  assert.equal(app.service.route.transcriber, "sensevoice-small-q8");
});

test("数据隐私模式里存 key、删模型：存 key 要写明哪一家；正在用的本机模型不让删", async (t) => {
  const app = await boot(t, { settings: PRIVATE });
  await app.keys.loadAtStartup();
  const unnamed = await app.keys.save("kimi-good");
  assert.equal(unnamed.ok, false);
  assert.match(zh.text(unnamed.problem), /写明是哪一家/);
  assert.deepEqual(await app.keys.save("kimi-good", { provider: "moonshot" }), { ok: true });
  assert.equal(app.keys.current.source, "none", "给别家存 key 不改变不用 key 的状态");

  const removed = await app.modes.removeModel("qwen3-asr-0.6b-q8");
  assert.equal(removed.ok, false);
  assert.equal((await app.modes.removeModel("sensevoice-small-q8")).ok, true);
});

test("检测数据隐私模式：不用 key 就能查", async (t) => {
  const app = await boot(t, { settings: LOCAL });
  const result = await app.modes.check("private", {});
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.source, "none");
});
