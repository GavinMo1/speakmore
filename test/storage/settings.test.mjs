import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createTranslator } from "../../src/i18n/index.mjs";
import {
  HOTKEY_IDS,
  hotkeyIdsFor,
  MODE_SETTINGS,
  overridingEnv,
  patchSettings,
  resolveSettings,
  routeOf,
  SETTINGS,
  saveSetting,
  unsetSetting,
} from "../../src/storage/settings.mjs";

const zh = createTranslator("zh-CN");
const en = createTranslator("en");
/** 报错里给人看的那句，按中文翻出来对得上 */
const said = (pattern) => (error) => pattern.test(zh.text(error.problem ?? error.message));

let dir;
let file;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "speakmore-settings-"));
  file = join(dir, "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 热键按系统分：这里用本机这个系统的，默认的是第一个，另挑一个不是默认的 */
const DEFAULT_HOTKEY = HOTKEY_IDS[0];
const OTHER_HOTKEY = HOTKEY_IDS.at(-1);

test("没有文件也没有环境变量时全用默认值", () => {
  assert.deepEqual(resolveSettings({ file, env: {} }), {
    hotkey: { value: DEFAULT_HOTKEY, source: "default" },
    mode: { value: "native", source: "default" },
    model: { value: "gemini/gemini-3.6-flash", source: "default" },
    thinking: { value: "MINIMAL", source: "default" },
    transcriber: { value: "qwen3-asr-0.6b-q8", source: "default" },
    privateTranscriber: { value: "qwen3-asr-0.6b-q8", source: "default" },
    polish: { value: "deepseek/deepseek-flash", source: "default" },
    customUrl: { value: "", source: "default" },
    customParams: { value: "", source: "default" },
    modelSource: { value: "cn", source: "default" },
    acceleration: { value: "auto", source: "default" },
    barHint: { value: "on", source: "default" },
    theme: { value: "ink", source: "default" },
    language: { value: "system", source: "default" },
  });
});

test("存下来的值下次读得到，没动过的仍是默认值", () => {
  saveSetting(file, "hotkey", OTHER_HOTKEY);
  saveSetting(file, "thinking", "low");
  const settings = resolveSettings({ file, env: {} });
  assert.deepEqual(settings.hotkey, { value: OTHER_HOTKEY, source: "file" });
  assert.deepEqual(settings.thinking, { value: "LOW", source: "file" });
  assert.deepEqual(settings.model, { value: "gemini/gemini-3.6-flash", source: "default" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { hotkey: OTHER_HOTKEY, thinking: "LOW" });
});

test("环境变量优先于文件", () => {
  saveSetting(file, "hotkey", OTHER_HOTKEY);
  saveSetting(file, "model", "gemini-3.8-flash");
  const settings = resolveSettings({
    file,
    env: { SPEAKMORE_HOTKEY: DEFAULT_HOTKEY, SPEAKMORE_MODEL: "openai", GEMINI_THINKING_LEVEL: "high" },
  });
  assert.deepEqual(settings.hotkey, { value: DEFAULT_HOTKEY, source: "env" });
  assert.deepEqual(settings.model, { value: "openai/gpt-audio-mini", source: "env" });
  assert.deepEqual(settings.thinking, { value: "HIGH", source: "env" });
});

test("本机模型的加速：auto（有显卡就用，出问题退回 CPU）或 cpu，大小写都认，别的不收", () => {
  saveSetting(file, "acceleration", "CPU");
  assert.deepEqual(resolveSettings({ file, env: {} }).acceleration, { value: "cpu", source: "file" });
  assert.deepEqual(resolveSettings({ file, env: { SPEAKMORE_ACCELERATION: "auto" } }).acceleration, {
    value: "auto",
    source: "env",
  });
  assert.throws(() => saveSetting(file, "acceleration", "gpu"), /auto \/ cpu/);
});

test("悬浮条上方的操作提示能关掉（GitHub issue #3）：on 或 off，大小写都认，别的不收", () => {
  saveSetting(file, "barHint", "OFF");
  assert.deepEqual(resolveSettings({ file, env: {} }).barHint, { value: "off", source: "file" });
  assert.deepEqual(resolveSettings({ file, env: { SPEAKMORE_BAR_HINT: "on" } }).barHint, {
    value: "on",
    source: "env",
  });
  assert.throws(() => saveSetting(file, "barHint", "hide"), /on \/ off/);
});

test("模型：写成 厂商/模型，只写厂商就用它的默认模型；存下来的都是 厂商/模型", () => {
  assert.equal(saveSetting(file, "model", "openai"), "openai/gpt-audio-mini");
  assert.equal(saveSetting(file, "model", "OpenAI/gpt-audio-1.5"), "openai/gpt-audio-1.5");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { model: "openai/gpt-audio-1.5" });
  assert.throws(() => saveSetting(file, "model", "deepseek/deepseek-flash"), said(/不认识 deepseek.*gemini \/ openai/));
  assert.equal(zh.text(SETTINGS.model.label("openai/gpt-audio-1.5")), "OpenAI");
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
  assert.throws(() => saveSetting(file, "volume", "11"), said(/hotkey.*model.*thinking/));
  assert.throws(() => saveSetting(file, "hotkey", "caps_lock"), said(new RegExp(HOTKEY_IDS.join(".*"))));
  assert.throws(() => saveSetting(file, "thinking", "none"), said(/MINIMAL.*LOW.*MEDIUM.*HIGH/));
  assert.throws(() => saveSetting(file, "model", "  "), said(/model/));
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
  assert.throws(() => saveSetting(file, "theme", "neon"), said(/ink \/ cinnabar \/ indigo/));
  assert.deepEqual(SETTINGS.theme.choices, ["ink", "cinnabar", "indigo"]);
});

test("带说明的设置项：热键给出键的名字，主题给出主题的名字，按界面语言写；语言的名字用它自己的语言写", () => {
  assert.equal(zh.text(SETTINGS.hotkey.label("fn")), "地球仪（fn）键");
  assert.equal(en.text(SETTINGS.hotkey.label("fn")), "Globe (fn)");
  assert.equal(zh.text(SETTINGS.theme.label("cinnabar")), "朱砂");
  assert.equal(en.text(SETTINGS.theme.label("cinnabar")), "Cinnabar");
  assert.equal(en.text(SETTINGS.language.label("zh-CN")), "简体中文");
  assert.equal(zh.text(SETTINGS.language.label("system")), "跟随系统");
});

test("热键能选哪几个按系统分，第一个是默认的；Windows 上是右 Alt 和右 Ctrl", () => {
  assert.deepEqual(hotkeyIdsFor("darwin"), ["right_option", "right_command", "right_control", "fn"]);
  assert.deepEqual(hotkeyIdsFor("win32"), ["right_alt", "right_ctrl"]);
  assert.deepEqual(HOTKEY_IDS, hotkeyIdsFor(process.platform));
  assert.equal(zh.text(SETTINGS.hotkey.label("right_alt")), "右 Alt 键");
  assert.equal(en.text(SETTINGS.hotkey.label("right_ctrl")), "Right Ctrl");
});

test("界面语言：默认跟随系统；写哪种都认（大小写、_ 不论），存下来是规整的 id；写了没有的说能填什么", () => {
  assert.deepEqual(resolveSettings({ file, env: {} }).language, { value: "system", source: "default" });
  assert.equal(saveSetting(file, "language", "zh_cn"), "zh-CN");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { language: "zh-CN" });
  assert.equal(saveSetting(file, "language", "EN"), "en");
  assert.equal(saveSetting(file, "language", "System"), "system");
  assert.deepEqual(resolveSettings({ file, env: { SPEAKMORE_LANGUAGE: "zh-CN" } }).language, {
    value: "zh-CN",
    source: "env",
  });
  assert.throws(() => saveSetting(file, "language", "ja"), said(/system \/ en \/ zh-CN/));
  assert.deepEqual(SETTINGS.language.choices, ["system", "en", "zh-CN"]);
});

test("写错时的说法也跟着语言换", () => {
  assert.throws(
    () => saveSetting(file, "hotkey", "caps_lock"),
    (error) => en.text(error.problem) === `hotkey is "caps_lock": must be one of ${HOTKEY_IDS.join(" / ")}`,
  );
  assert.throws(
    () => resolveSettings({ file, env: { SPEAKMORE_THEME: "neon" } }),
    (error) =>
      en.text(error.problem) === 'The SPEAKMORE_THEME env var is "neon": must be one of ink / cinnabar / indigo',
  );
});

test("环境变量或文件里的值写错时报错，不悄悄换成默认值", () => {
  assert.throws(() => resolveSettings({ file, env: { SPEAKMORE_HOTKEY: "caps_lock" } }), said(/SPEAKMORE_HOTKEY/));
  writeFileSync(file, JSON.stringify({ hotkey: "caps_lock" }));
  assert.throws(() => resolveSettings({ file, env: {} }), said(/settings\.json/));
  writeFileSync(file, "{ 不是 JSON");
  assert.throws(() => resolveSettings({ file, env: {} }), said(/settings\.json/));
});

test("取消一项设置后回到默认值，其余的不动", () => {
  saveSetting(file, "hotkey", OTHER_HOTKEY);
  saveSetting(file, "model", "gemini-3.8-flash");
  unsetSetting(file, "hotkey");
  const settings = resolveSettings({ file, env: {} });
  assert.deepEqual(settings.hotkey, { value: DEFAULT_HOTKEY, source: "default" });
  assert.deepEqual(settings.model, { value: "gemini/gemini-3.8-flash", source: "file" });
  assert.throws(() => unsetSetting(file, "volume"), said(/hotkey/));
});

test("数据目录还不存在时也能保存", () => {
  const nested = join(dir, "not-yet", "settings.json");
  saveSetting(nested, "hotkey", OTHER_HOTKEY);
  assert.equal(resolveSettings({ file: nested, env: {} }).hotkey.value, OTHER_HOTKEY);
});

test("Gemini 的模型存成 0.3 也读得懂的写法（只写模型名），退回旧版本时设置照样能用；读出来统一是 厂商/模型", () => {
  assert.equal(saveSetting(file, "model", "gemini"), "gemini/gemini-3.6-flash");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { model: "gemini-3.6-flash" });
  assert.equal(resolveSettings({ file, env: {} }).model.value, "gemini/gemini-3.6-flash");
  // 别家的 0.3 本来就不认，照常存 厂商/模型
  saveSetting(file, "model", "openai");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { model: "openai/gpt-audio-mini" });
});

test("识别链路：默认是原生的；改成 local 后，路线里是本地模型、润色的那家和自定义地址", () => {
  assert.deepEqual(routeOf(resolveSettings({ file, env: {} })), {
    mode: "native",
    model: { provider: "gemini", model: "gemini-3.6-flash" },
    thinkingLevel: "MINIMAL",
  });
  saveSetting(file, "mode", "Local");
  saveSetting(file, "polish", "custom/Qwen/Qwen3-8B");
  saveSetting(file, "customUrl", "https://api.siliconflow.cn/v1/chat/completions");
  const settings = resolveSettings({ file, env: {} });
  assert.deepEqual(settings.customUrl, { value: "https://api.siliconflow.cn/v1", source: "file" });
  assert.deepEqual(routeOf(settings), {
    mode: "local",
    transcriber: "qwen3-asr-0.6b-q8",
    polish: { vendor: "custom", model: "Qwen/Qwen3-8B" },
    customUrl: "https://api.siliconflow.cn/v1",
    customParams: null,
  });
  // 环境变量也能换，和单独启动服务端时同名
  const env = {
    SPEAKMORE_MODE: "native",
    SPEAKMORE_POLISH: "deepseek",
    SPEAKMORE_TRANSCRIBER: "sensevoice-small-q8",
  };
  const overridden = resolveSettings({ file, env });
  assert.equal(overridden.mode.value, "native");
  assert.equal(overridden.polish.value, "deepseek/deepseek-flash");
  assert.equal(overridden.transcriber.value, "sensevoice-small-q8");
});

test("每种模式的路线只看它自己那几项：可以拼出不是正在用的那种模式的路线", () => {
  saveSetting(file, "model", "openai");
  saveSetting(file, "polish", "deepseek/deepseek-v4-pro");
  const settings = resolveSettings({ file, env: {} });
  assert.equal(settings.mode.value, "native");
  assert.deepEqual(routeOf(settings, "local"), {
    mode: "local",
    transcriber: "qwen3-asr-0.6b-q8",
    polish: { vendor: "deepseek", model: "deepseek-v4-pro" },
    customUrl: null,
    customParams: null,
  });
  assert.deepEqual(routeOf(settings, "native").model, { provider: "openai", model: "gpt-audio-mini" });
});

test("每种模式自己的那几项：native 是模型和思考档位，local 是两跳的，private 是它自己的本机模型", () => {
  assert.deepEqual(MODE_SETTINGS, {
    native: ["model", "thinking"],
    local: ["transcriber", "polish", "customUrl", "customParams"],
    private: ["privateTranscriber"],
  });
});

test("自定义服务的额外参数：存成紧凑的 JSON，路线里是对象；没填、{} 是 null；写错了拒绝保存，说哪里不对", () => {
  saveSetting(file, "mode", "local");
  saveSetting(file, "polish", "custom/gpt-5-mini");
  saveSetting(file, "customUrl", "https://router.example/v1");
  assert.equal(
    saveSetting(file, "customParams", ' {\n  "max_completion_tokens": 1024,\n  "reasoning_effort": "minimal"\n} '),
    '{"max_completion_tokens":1024,"reasoning_effort":"minimal"}',
  );
  const settings = resolveSettings({ file, env: {} });
  assert.deepEqual(settings.customParams, {
    value: '{"max_completion_tokens":1024,"reasoning_effort":"minimal"}',
    source: "file",
  });
  assert.deepEqual(routeOf(settings).customParams, { max_completion_tokens: 1024, reasoning_effort: "minimal" });
  // 环境变量也能写，和单独启动服务端时同名
  const fromEnv = resolveSettings({ file, env: { SPEAKMORE_CUSTOM_PARAMS: '{"temperature": 0.2}' } });
  assert.deepEqual(routeOf(fromEnv).customParams, { temperature: 0.2 });
  assert.equal(saveSetting(file, "customParams", "{}"), "");
  assert.equal(routeOf(resolveSettings({ file, env: {} })).customParams, null);
  assert.throws(() => saveSetting(file, "customParams", "{max_tokens: 1}"), said(/customParams.*JSON/));
  assert.throws(() => saveSetting(file, "customParams", '{"model": "x"}'), said(/model/));
});

test("数据隐私模式的本机模型：和 local 的第一跳分开存，只认本机模型的 id，云端的拒绝", () => {
  const settings = resolveSettings({ file, env: {} });
  assert.deepEqual(routeOf(settings, "private"), { mode: "private", transcriber: "qwen3-asr-0.6b-q8" });
  saveSetting(file, "transcriber", "bailian/qwen3-asr-flash");
  saveSetting(file, "privateTranscriber", "sensevoice-small-q8");
  const saved = resolveSettings({ file, env: {} });
  assert.equal(routeOf(saved, "private").transcriber, "sensevoice-small-q8");
  assert.equal(routeOf(saved, "local").transcriber, "bailian/qwen3-asr-flash");
  assert.throws(() => saveSetting(file, "privateTranscriber", "bailian/qwen3-asr-flash"), /qwen3-asr-0\.6b-q8/);
  const fromEnv = resolveSettings({ file, env: { SPEAKMORE_PRIVATE_TRANSCRIBER: "qwen3-asr-0.6b-q8" } });
  assert.equal(fromEnv.privateTranscriber.value, "qwen3-asr-0.6b-q8");
  assert.equal(patchSettings(saved, { mode: "PRIVATE" }).mode.value, "private");
});

test("patchSettings：按要改的几项拼出改后的设置（不写文件），写错了照保存时的规矩报错", () => {
  const settings = resolveSettings({ file, env: {} });
  const patched = patchSettings(settings, { mode: "LOCAL", polish: "deepseek" });
  assert.equal(patched.mode.value, "local");
  assert.equal(patched.polish.value, "deepseek/deepseek-flash");
  assert.equal(patched.model, settings.model);
  assert.equal(existsSync(file), false);
  assert.throws(() => patchSettings(settings, { polish: "nobody/x" }), said(/polish.*deepseek/));
  assert.throws(() => patchSettings(settings, { colour: "red" }), said(/colour/));
});

test("识别链路的几项写错了拒绝保存，说能填什么；自定义地址可以清空", () => {
  assert.throws(() => saveSetting(file, "mode", "cloud"), said(/native \/ local/));
  assert.throws(() => saveSetting(file, "transcriber", "whisper-9"), said(/qwen3-asr-0\.6b-q8/));
  assert.throws(() => saveSetting(file, "polish", "nobody/x"), said(/deepseek/));
  assert.throws(() => saveSetting(file, "customUrl", "api.example.com"), said(/https:\/\//));
  saveSetting(file, "customUrl", "https://x.example/v1");
  assert.equal(saveSetting(file, "customUrl", ""), "");
});
