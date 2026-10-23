import assert from "node:assert/strict";
import { test } from "node:test";
import { createLookupEngine } from "../../../src/app/lookup/engine.mjs";
import { createTranslator } from "../../../src/i18n/index.mjs";
import { ModelError } from "../../../src/server/providers/errors.mjs";

const zh = createTranslator("zh-CN");
const quiet = { info() {}, warn() {}, error() {} };

/** 设置：resolveSettings 的样子，只放划词那几项 */
const settingsWith = (overrides = {}) =>
  Object.fromEntries(
    Object.entries({
      "lookup.to": "zh-CN",
      "lookup.model": "deepseek/deepseek-flash",
      "lookup.customUrl": "",
      "lookup.customParams": "",
      ...overrides,
    }).map(([name, value]) => [name, { value, source: "file" }]),
  );

function engineWith({ settings = settingsWith(), keys = { deepseek: "sk-deepseek" }, custom = null, fail } = {}) {
  const built = [];
  const translated = [];
  const engine = createLookupEngine({
    readSettings: () => settings,
    keyOf: (id) => {
      if (keys[id] instanceof Error) throw keys[id];
      return keys[id] ? { apiKey: keys[id], source: "stored" } : null;
    },
    customKey: () => (custom ? { apiKey: custom, source: "stored" } : null),
    createTranslator: async (options) => {
      built.push(options);
      return {
        async translate(text, { language, lookupId }) {
          translated.push({ text, language: language.id, lookupId });
          if (fail) throw fail;
          return { text: `译：${text}` };
        },
        async warmUp() {
          if (fail) throw fail;
        },
      };
    },
    log: quiet,
    onCall: () => {},
  });
  return { engine, built, translated };
}

test("按设置交给那一家，key 用那一家的；同样的设置和 key 不重装", async () => {
  const { engine, built, translated } = engineWith();
  assert.deepEqual(await engine.translate("hello", { language: "ja", lookupId: "l1" }), { text: "译：hello" });
  await engine.translate("again", { language: "zh-CN", lookupId: "l2" });
  assert.equal(built.length, 1);
  assert.deepEqual(built[0].choice, { vendor: "deepseek", model: "deepseek-flash" });
  assert.equal(built[0].apiKey, "sk-deepseek");
  assert.deepEqual(translated, [
    { text: "hello", language: "ja", lookupId: "l1" },
    { text: "again", language: "zh-CN", lookupId: "l2" },
  ]);
  assert.equal(engine.current().to, "zh-CN");
});

test("那一家没有 key：说缺哪家的 key，kind 是 missing（卡片上给配置密钥）", async () => {
  const { engine } = engineWith({ settings: settingsWith({ "lookup.model": "moonshot" }) });
  await assert.rejects(engine.translate("x", { language: "zh-CN", lookupId: "l" }), (error) => {
    assert.equal(error.kind, "missing");
    assert.equal(zh.text(error.problem), "Kimi 未配置密钥");
    return true;
  });
});

test("存着的 key 解不开：kind 是 unreadable，说重新填", async () => {
  const { engine } = engineWith({ keys: { deepseek: new Error("钥匙串里的密钥没了") } });
  await assert.rejects(engine.translate("x", { language: "zh-CN", lookupId: "l" }), (error) => {
    assert.equal(error.kind, "unreadable");
    assert.match(zh.text(error.problem), /DeepSeek key 读不出来/);
    return true;
  });
});

test("自定义服务：地址、参数、key 都是划词自己的；没填地址或 key 时说清缺什么", async () => {
  const settings = settingsWith({
    "lookup.model": "custom/qwen3:8b",
    "lookup.customUrl": "http://127.0.0.1:11434/v1",
    "lookup.customParams": '{"keep_alive":"5m"}',
  });
  const { engine, built } = engineWith({ settings, custom: "sk-local", keys: {} });
  await engine.translate("x", { language: "en", lookupId: "l" });
  assert.deepEqual(
    [built[0].choice, built[0].customUrl, built[0].customParams, built[0].apiKey],
    [{ vendor: "custom", model: "qwen3:8b" }, "http://127.0.0.1:11434/v1", { keep_alive: "5m" }, "sk-local"],
  );
  const noKey = engineWith({ settings, keys: {} });
  await assert.rejects(noKey.engine.translate("x", { language: "en", lookupId: "l" }), { kind: "missing" });
  const noUrl = engineWith({ settings: settingsWith({ "lookup.model": "custom/qwen3:8b" }), custom: "sk-local" });
  await assert.rejects(noUrl.engine.translate("x", { language: "en", lookupId: "l" }), (error) => {
    assert.equal(error.kind, "setup");
    assert.match(zh.text(error.problem), /自定义服务/);
    return true;
  });
});

test("检查：按设置（再换上要改的几项）发一个最小的请求；不通过照实说原因和种类", async () => {
  const { engine, built } = engineWith({ keys: { deepseek: "sk-deepseek", bailian: "sk-bailian" } });
  const passed = await engine.check({ "lookup.model": "bailian" });
  assert.equal(passed.ok, true);
  assert.ok(Number.isInteger(passed.ms));
  assert.deepEqual(built.at(-1).choice, { vendor: "bailian", model: "qwen3.8-flash" });
  const rejected = engineWith({ fail: new ModelError({ kind: "key", problem: "这把 key 无效", detail: "401" }) });
  assert.deepEqual(await rejected.engine.check(), { ok: false, cause: "key", problem: "这把 key 无效" });
  const missing = await engineWith({ keys: {} }).engine.check();
  assert.equal(missing.cause, "missing");
});

test("检查自定义服务时可以带一把还没存的 key：拿它验，不用存着的", async () => {
  const { engine, built } = engineWith({ custom: "sk-old", keys: {} });
  const changes = { "lookup.model": "custom/qwen3:8b", "lookup.customUrl": "http://127.0.0.1:11434/v1" };
  assert.equal((await engine.check(changes, { apiKey: "sk-new" })).ok, true);
  assert.equal(built.at(-1).apiKey, "sk-new");
  // 没存过 key、也没带：说缺 key
  const fresh = engineWith({ keys: {} });
  assert.equal((await fresh.engine.check(changes)).cause, "missing");
  // 选的不是自定义服务时带的 key 不算数：清单里的厂商用它自己那把（和语音那边同一把）
  const vendor = engineWith();
  await vendor.engine.check({}, { apiKey: "sk-new" });
  assert.equal(vendor.built.at(-1).apiKey, "sk-deepseek");
});
