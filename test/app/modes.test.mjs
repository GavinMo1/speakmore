import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createModeSwitch } from "../../src/app/modes.mjs";
import { createTranslator, msg } from "../../src/i18n/index.mjs";
import { resolveSettings, routeOf, saveSetting } from "../../src/storage/settings.mjs";

const zh = createTranslator("zh-CN");

let dir;
let file;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "speakmore-modes-"));
  file = join(dir, "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const saved = (name) => resolveSettings({ file, env: {} })[name].value;

/**
 * 假的服务和 key 管理：keys.use 照 verdict 判通不通过，通过了服务就换上那条路线。
 * calls 记下内核对它们做了什么
 */
function setup({ verdict = () => ({ ok: true }), env = {} } = {}) {
  const calls = [];
  const service = {
    route: routeOf(resolveSettings({ file, env })),
    switchTranscriber(model) {
      calls.push({ switchTranscriber: model });
      service.route = { ...service.route, transcriber: model };
    },
  };
  const keys = {
    async use({ route }) {
      calls.push({ use: route });
      const result = verdict(route);
      if (result.ok) service.route = route;
      return result;
    },
    async check(route) {
      calls.push({ check: route });
      return { ok: true, source: "stored", ms: 5 };
    },
  };
  const modes = createModeSwitch({ service, keys, settingsFile: file, env, log: { info() {} } });
  return { modes, service, calls };
}

// ---------- 模式这一层 ----------

test("切模式：按设置里那种模式自己的几项拼出路线，验证过了才换，换了才记进设置", async () => {
  saveSetting(file, "polish", "deepseek/deepseek-v4-pro");
  const { modes, service, calls } = setup();
  assert.deepEqual(await modes.switchMode("local"), { ok: true });
  assert.deepEqual(calls, [
    {
      use: {
        mode: "local",
        transcriber: "qwen3-asr-0.6b-q8",
        polish: { vendor: "deepseek", model: "deepseek-v4-pro" },
        customUrl: null,
      },
    },
  ]);
  assert.equal(service.route.mode, "local");
  assert.equal(saved("mode"), "local");
});

test("切模式没通过（比如还没有那一家的 key）：什么都不变，原因照实带回", async () => {
  const problem = msg("key.noKeyFor", { provider: "DeepSeek" });
  const { modes, service } = setup({ verdict: () => ({ ok: false, problem }) });
  const result = await modes.switchMode("local");
  assert.equal(result.ok, false);
  assert.match(zh.text(result.problem), /DeepSeek/);
  assert.equal(service.route.mode, "native");
  assert.equal(saved("mode"), "native");
});

test("切到正在用的模式：不用再验证；写错的模式名说能填什么", async () => {
  const { modes, calls } = setup();
  assert.deepEqual(await modes.switchMode("native"), { ok: true });
  assert.deepEqual(calls, []);
  const wrong = await modes.switchMode("cloud");
  assert.equal(wrong.ok, false);
  assert.match(zh.text(wrong.problem), /native \/ local/);
});

// ---------- native 这一层 ----------

test("native 换模型：在 native 模式时当场验证、换上；只写 model，不碰 local 的设置", async () => {
  const { modes, service } = setup();
  assert.deepEqual(await modes.setModel("openai"), { ok: true });
  assert.deepEqual(service.route.model, { provider: "openai", model: "gpt-audio-mini" });
  assert.equal(saved("model"), "openai/gpt-audio-mini");
  assert.equal(saved("polish"), "deepseek/deepseek-flash");
});

test("native 换模型时正在 local 模式：不换也不存，说要先切到 native", async () => {
  saveSetting(file, "mode", "local");
  const { modes, service, calls } = setup();
  const result = await modes.setModel("openai/gpt-audio-1.5");
  assert.equal(result.ok, false);
  assert.match(zh.text(result.problem), /现在是 local 模式.*native 模式/);
  assert.deepEqual(calls, []);
  assert.equal(service.route.mode, "local");
  assert.equal(saved("model"), "gemini/gemini-3.6-flash");
});

test("native 只认收音频的那几家：写润色的厂商、写错的名字都不收", async () => {
  const { modes, calls } = setup();
  const result = await modes.setModel("deepseek/deepseek-flash");
  assert.equal(result.ok, false);
  assert.match(zh.text(result.problem), /gemini \/ openai/);
  assert.deepEqual(calls, []);
  assert.equal(saved("model"), "gemini/gemini-3.6-flash");
});

// ---------- local 的两跳 ----------

test("local 第一跳换本地模型：不验证 key，只让服务换模型（后台下载、装载）", async () => {
  saveSetting(file, "mode", "local");
  const { modes, calls } = setup();
  assert.deepEqual(await modes.setTranscriber("sensevoice-small-q8"), { ok: true });
  assert.deepEqual(calls, [{ switchTranscriber: "sensevoice-small-q8" }]);
  assert.equal(saved("transcriber"), "sensevoice-small-q8");
});

test("local 第二跳换润色：验证那一家的 key；自定义服务连地址一起换，验证过才一起存", async () => {
  saveSetting(file, "mode", "local");
  const { modes, service } = setup();
  const result = await modes.setPolish("custom/qwen3:8b", { customUrl: "http://127.0.0.1:11434/v1/chat/completions" });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(service.route.polish, { vendor: "custom", model: "qwen3:8b" });
  assert.equal(service.route.customUrl, "http://127.0.0.1:11434/v1");
  assert.equal(saved("polish"), "custom/qwen3:8b");
  assert.equal(saved("customUrl"), "http://127.0.0.1:11434/v1");
});

test("local 第二跳没通过：润色和地址都不存", async () => {
  saveSetting(file, "mode", "local");
  const { modes } = setup({ verdict: () => ({ ok: false, problem: "连不上" }) });
  const result = await modes.setPolish("custom/m", { customUrl: "http://x.example/v1" });
  assert.equal(result.ok, false);
  assert.equal(saved("polish"), "deepseek/deepseek-flash");
  assert.equal(saved("customUrl"), "");
});

test("local 的两跳在 native 模式时：不能换（没法选），不验证、不存，说要先切到 local", async () => {
  const { modes, calls } = setup();
  const first = await modes.setTranscriber("sensevoice-small-q8");
  assert.equal(first.ok, false);
  assert.match(zh.text(first.problem), /本机转写模型（第一跳）.*local 模式/);
  const second = await modes.setPolish("deepseek/deepseek-v4-pro");
  assert.match(zh.text(second.problem), /润色模型（第二跳）.*local 模式/);
  assert.deepEqual(calls, []);
  assert.equal(saved("transcriber"), "qwen3-asr-0.6b-q8");
  assert.equal(saved("polish"), "deepseek/deepseek-flash");
});

test("local 的两跳只认各自的东西：第一跳不收云端模型，第二跳不收收音频的厂商", async () => {
  saveSetting(file, "mode", "local");
  const { modes } = setup();
  assert.match(zh.text((await modes.setTranscriber("gemini")).problem), /qwen3-asr-0\.6b-q8/);
  assert.match(zh.text((await modes.setPolish("openai/gpt-audio-mini")).problem), /deepseek/);
});

test("切模式时可以连带那种模式自己的设置：一起验证、一起存（没有 DeepSeek 的 key、直接用自定义服务）", async () => {
  const { modes, service } = setup();
  const result = await modes.switchMode("local", { polish: "custom/qwen3:8b", customUrl: "http://127.0.0.1:11434/v1" });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(service.route.polish, { vendor: "custom", model: "qwen3:8b" });
  assert.deepEqual(
    [saved("mode"), saved("polish"), saved("customUrl")],
    ["local", "custom/qwen3:8b", "http://127.0.0.1:11434/v1"],
  );
});

test("切模式时带的设置不是那种模式的：不切，说清楚", async () => {
  const { modes, calls } = setup();
  const result = await modes.switchMode("local", { model: "openai" });
  assert.equal(result.ok, false);
  assert.match(zh.text(result.problem), /model 不是 local 模式的设置.*transcriber/);
  assert.deepEqual(calls, []);
});

test("连带的设置没通过验证：模式和那几项都不存", async () => {
  const { modes, service } = setup({ verdict: () => ({ ok: false, problem: "连不上" }) });
  const result = await modes.switchMode("local", { polish: "custom/m", customUrl: "http://x.example/v1" });
  assert.equal(result.ok, false);
  assert.equal(service.route.mode, "native");
  assert.deepEqual([saved("mode"), saved("polish")], ["native", "deepseek/deepseek-flash"]);
});

test("已经在 local 时再切 local 并带上第一跳：照样换上（同一条路线就不再验证）", async () => {
  saveSetting(file, "mode", "local");
  const { modes, service, calls } = setup();
  assert.deepEqual(await modes.switchMode("local"), { ok: true });
  assert.deepEqual(calls, []);
  assert.deepEqual(await modes.switchMode("local", { transcriber: "sensevoice-small-q8" }), { ok: true });
  assert.equal(service.route.transcriber, "sensevoice-small-q8");
});

// ---------- 存设置 ----------

test("存下来的那项正被环境变量盖着：照样换，附一句下次启动会被盖掉", async () => {
  const { modes } = setup({ env: { SPEAKMORE_MODEL: "gemini" } });
  const result = await modes.setModel("openai");
  assert.equal(result.ok, true);
  assert.match(zh.text(result.note), /SPEAKMORE_MODEL/);
});

// ---------- 验证用的路线 ----------

test("给某一家存 key 前拿哪条路线验证：收音频的走 native，润色的走 local；要换成的模型可以一起给", () => {
  saveSetting(file, "model", "openai/gpt-audio-1.5");
  const { modes } = setup();
  assert.deepEqual(modes.routeForVendor("openai").model, { provider: "openai", model: "gpt-audio-1.5" });
  assert.deepEqual(modes.routeForVendor("gemini").model, { provider: "gemini", model: "gemini-3.6-flash" });
  assert.deepEqual(modes.routeForVendor("deepseek").polish, { vendor: "deepseek", model: "deepseek-flash" });
  const custom = modes.routeForVendor("custom", { polish: "custom/m", customUrl: "http://x.example/v1" });
  assert.deepEqual([custom.mode, custom.polish.model, custom.customUrl], ["local", "m", "http://x.example/v1"]);
  // 自定义服务没有默认模型
  assert.throws(
    () => modes.routeForVendor("custom"),
    (error) => /custom\/模型名/.test(zh.text(error.problem)),
  );
});

test("检查：按那一层拼出路线交给 key 管理去试，不换掉正在用的", async () => {
  const { modes, calls } = setup();
  assert.equal((await modes.check("local", { polish: "deepseek/deepseek-v4-pro" })).ok, true);
  assert.deepEqual(calls[0].check.polish, { vendor: "deepseek", model: "deepseek-v4-pro" });
  assert.equal((await modes.check("native", {})).ok, true);
  assert.deepEqual(calls[1].check.model, { provider: "gemini", model: "gemini-3.6-flash" });
  const wrong = await modes.check("native", { model: "nobody/x" });
  assert.deepEqual([wrong.ok, wrong.cause], [false, "other"]);
});
