import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { HOTKEYS, resolveSettings, saveSetting, unsetSetting } from "../src/settings.mjs";

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
    model: { value: "gemini-3.5-flash", source: "default" },
    thinking: { value: "MINIMAL", source: "default" },
  });
});

test("存下来的值下次读得到，没动过的仍是默认值", () => {
  saveSetting(file, "hotkey", "fn");
  saveSetting(file, "thinking", "low");
  const settings = resolveSettings({ file, env: {} });
  assert.deepEqual(settings.hotkey, { value: "fn", source: "file" });
  assert.deepEqual(settings.thinking, { value: "LOW", source: "file" });
  assert.deepEqual(settings.model, { value: "gemini-3.5-flash", source: "default" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { hotkey: "fn", thinking: "LOW" });
});

test("环境变量优先于文件", () => {
  saveSetting(file, "hotkey", "fn");
  saveSetting(file, "model", "gemini-3.8-flash");
  const settings = resolveSettings({
    file,
    env: { SPEAKMORE_HOTKEY: "right_command", GEMINI_MODEL: "gemini-3.6-flash", GEMINI_THINKING_LEVEL: "high" },
  });
  assert.deepEqual(settings.hotkey, { value: "right_command", source: "env" });
  assert.deepEqual(settings.model, { value: "gemini-3.6-flash", source: "env" });
  assert.deepEqual(settings.thinking, { value: "HIGH", source: "env" });
});

test("不认识的设置项、不认识的热键、不认识的思考档位都拒绝保存，并列出能填什么", () => {
  assert.throws(() => saveSetting(file, "volume", "11"), /hotkey.*model.*thinking/);
  assert.throws(() => saveSetting(file, "hotkey", "caps_lock"), new RegExp(Object.keys(HOTKEYS).join(".*")));
  assert.throws(() => saveSetting(file, "thinking", "none"), /MINIMAL.*LOW.*MEDIUM.*HIGH/);
  assert.throws(() => saveSetting(file, "model", "  "), /model/);
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
  assert.deepEqual(settings.model, { value: "gemini-3.8-flash", source: "file" });
  assert.throws(() => unsetSetting(file, "volume"), /hotkey/);
});

test("数据目录还不存在时也能保存", () => {
  const nested = join(dir, "not-yet", "settings.json");
  saveSetting(nested, "hotkey", "fn");
  assert.equal(resolveSettings({ file: nested, env: {} }).hotkey.value, "fn");
});
