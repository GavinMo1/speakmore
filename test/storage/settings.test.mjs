import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  HOTKEY_KEYCAPS,
  HOTKEYS,
  overridingEnv,
  resolveSettings,
  SETTINGS,
  saveSetting,
  unsetSetting,
} from "../../src/storage/settings.mjs";

let dir;
let file;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "speakmore-settings-"));
  file = join(dir, "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("没有文件也没有环境变量时全用默认值", () => {
  assert.deepEqual(resolveSettings({ file, env: {} }), {
    hotkey: { value: "right_option", source: "default" },
    model: { value: "gemini/gemini-3.5-flash", source: "default" },
    thinking: { value: "MINIMAL", source: "default" },
    theme: { value: "ink", source: "default" },
  });
});

test("存下来的值下次读得到，没动过的仍是默认值", () => {
  saveSetting(file, "hotkey", "fn");
  saveSetting(file, "thinking", "low");
  const settings = resolveSettings({ file, env: {} });
  assert.deepEqual(settings.hotkey, { value: "fn", source: "file" });
  assert.deepEqual(settings.thinking, { value: "LOW", source: "file" });
  assert.deepEqual(settings.model, { value: "gemini/gemini-3.5-flash", source: "default" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { hotkey: "fn", thinking: "LOW" });
});

test("环境变量优先于文件", () => {
  saveSetting(file, "hotkey", "fn");
  saveSetting(file, "model", "gemini-3.8-flash");
  const settings = resolveSettings({
    file,
    env: { SPEAKMORE_HOTKEY: "right_command", SPEAKMORE_MODEL: "openai", GEMINI_THINKING_LEVEL: "high" },
  });
  assert.deepEqual(settings.hotkey, { value: "right_command", source: "env" });
  assert.deepEqual(settings.model, { value: "openai/gpt-audio-mini", source: "env" });
  assert.deepEqual(settings.thinking, { value: "HIGH", source: "env" });
});

test("模型：写成 厂商/模型，只写厂商就用它的默认模型；存下来的都是 厂商/模型", () => {
  assert.equal(saveSetting(file, "model", "openai"), "openai/gpt-audio-mini");
  assert.equal(saveSetting(file, "model", "OpenAI/gpt-audio-1.5"), "openai/gpt-audio-1.5");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { model: "openai/gpt-audio-1.5" });
  assert.throws(() => saveSetting(file, "model", "deepseek/deepseek-flash"), /不认识 deepseek.*gemini \/ openai/);
  assert.equal(SETTINGS.model.label("openai/gpt-audio-1.5"), "OpenAI");
});

test("0.3 以前的写法照样认：设置文件里只写了 Gemini 的模型名，环境变量 GEMINI_MODEL", () => {
  writeFileSync(file, JSON.stringify({ model: "gemini-3.8-flash" }));
  assert.deepEqual(resolveSettings({ file, env: {} }).model, { value: "gemini/gemini-3.8-flash", source: "file" });
  // 用的是旧的环境变量时，说清是哪一个，换主题之类的提示才不会指错
  assert.deepEqual(resolveSettings({ file, env: { GEMINI_MODEL: "gemini-3.6-flash" } }).model, {
    value: "gemini/gemini-3.6-flash",
    source: "env",
    env: "GEMINI_MODEL",
  });
  // 新旧都设了：新的优先
  assert.equal(
    resolveSettings({ file, env: { GEMINI_MODEL: "gemini-3.6-flash", SPEAKMORE_MODEL: "openai" } }).model.value,
    "openai/gpt-audio-mini",
  );
});

test("overridingEnv：这一项现在被哪个环境变量盖着；没有就是 null", () => {
  assert.equal(overridingEnv("model", {}), null);
  assert.equal(overridingEnv("model", { GEMINI_MODEL: "x" }), "GEMINI_MODEL");
  assert.equal(overridingEnv("model", { GEMINI_MODEL: "x", SPEAKMORE_MODEL: "openai" }), "SPEAKMORE_MODEL");
  assert.equal(overridingEnv("theme", { SPEAKMORE_THEME: "ink" }), "SPEAKMORE_THEME");
});

test("不认识的设置项、不认识的热键、不认识的思考档位都拒绝保存，并列出能填什么", () => {
  assert.throws(() => saveSetting(file, "volume", "11"), /hotkey.*model.*thinking/);
  assert.throws(() => saveSetting(file, "hotkey", "caps_lock"), new RegExp(Object.keys(HOTKEYS).join(".*")));
  assert.throws(() => saveSetting(file, "thinking", "none"), /MINIMAL.*LOW.*MEDIUM.*HIGH/);
  assert.throws(() => saveSetting(file, "model", "  "), /model/);
});

test("主题：写 id 或写名字都行，存下来的是 id；没有的那一套拒绝，并列出有哪几套", () => {
  assert.equal(saveSetting(file, "theme", "cinnabar"), "cinnabar");
  assert.equal(saveSetting(file, "theme", "靛青"), "indigo");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { theme: "indigo" });
  assert.deepEqual(resolveSettings({ file, env: {} }).theme, { value: "indigo", source: "file" });
  assert.deepEqual(resolveSettings({ file, env: { SPEAKMORE_THEME: "朱砂" } }).theme, {
    value: "cinnabar",
    source: "env",
  });
  assert.throws(() => saveSetting(file, "theme", "neon"), /ink \/ cinnabar \/ indigo/);
  assert.deepEqual(SETTINGS.theme.choices, ["ink", "cinnabar", "indigo"]);
});

test("带说明的设置项：热键给出键的名字，主题给出主题的名字；每个热键都有一个写在悬浮条上的短名字", () => {
  assert.equal(SETTINGS.hotkey.label("fn"), "地球仪（fn）键");
  assert.equal(SETTINGS.theme.label("cinnabar"), "朱砂");
  assert.deepEqual(Object.keys(HOTKEY_KEYCAPS), Object.keys(HOTKEYS));
});

test("环境变量或文件里的值写错时报错，不悄悄换成默认值", () => {
  assert.throws(() => resolveSettings({ file, env: { SPEAKMORE_HOTKEY: "caps_lock" } }), /SPEAKMORE_HOTKEY/);
  writeFileSync(file, JSON.stringify({ hotkey: "caps_lock" }));
  assert.throws(() => resolveSettings({ file, env: {} }), /settings\.json/);
  writeFileSync(file, "{ 不是 JSON");
  assert.throws(() => resolveSettings({ file, env: {} }), /settings\.json/);
});

test("取消一项设置后回到默认值，其余的不动", () => {
  saveSetting(file, "hotkey", "fn");
  saveSetting(file, "model", "gemini-3.8-flash");
  unsetSetting(file, "hotkey");
  const settings = resolveSettings({ file, env: {} });
  assert.deepEqual(settings.hotkey, { value: "right_option", source: "default" });
  assert.deepEqual(settings.model, { value: "gemini/gemini-3.8-flash", source: "file" });
  assert.throws(() => unsetSetting(file, "volume"), /hotkey/);
});

test("数据目录还不存在时也能保存", () => {
  const nested = join(dir, "not-yet", "settings.json");
  saveSetting(nested, "hotkey", "fn");
  assert.equal(resolveSettings({ file: nested, env: {} }).hotkey.value, "fn");
});

test("Gemini 的模型存成 0.3 也读得懂的写法（只写模型名），退回旧版本时设置照样能用；读出来统一是 厂商/模型", () => {
  assert.equal(saveSetting(file, "model", "gemini"), "gemini/gemini-3.5-flash");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { model: "gemini-3.5-flash" });
  assert.equal(resolveSettings({ file, env: {} }).model.value, "gemini/gemini-3.5-flash");
  // 别家的 0.3 本来就不认，照常存 厂商/模型
  saveSetting(file, "model", "openai");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { model: "openai/gpt-audio-mini" });
});
