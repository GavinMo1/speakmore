import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { renderConfig } from "../../src/cli/render/settings.mjs";
import { ACTIONS } from "../../src/hotkeys/actions.mjs";
import { bindingTable, resolveHotkeys } from "../../src/hotkeys/bindings.mjs";
import { LEGACY_HOTKEYS } from "../../src/hotkeys/legacy.mjs";
import { envOf, settingNameOf } from "../../src/hotkeys/settings.mjs";
import { checkBindings } from "../../src/hotkeys/validate.mjs";
import { createTranslator, LOCALES } from "../../src/i18n/index.mjs";
import { resolveSettings, SETTINGS } from "../../src/storage/settings.mjs";

// 动作目录是"有哪些动作"唯一的出处（docs/hotkey-research.md 5.4）：按它逐个动作查，生成出来的每一处都有它。
// 目录里加了一行而漏了哪一处，这里会红。

const ROOT = resolve(import.meta.dirname, "../..");
const PLATFORMS = ["darwin", "win32"];

test("每个动作：两个系统都有默认组合（D10），默认组合能绑、彼此不撞", () => {
  for (const platform of PLATFORMS) {
    for (const action of ACTIONS) assert.ok(action.defaults[platform]?.length > 0, `${action.id} 在 ${platform} 上`);
    const defaults = Object.fromEntries(
      ACTIONS.map((action) => [action.id, action.defaults[platform].map((c) => c.split("+"))]),
    );
    const rejected = checkBindings(defaults, platform).filter((problem) => problem.level === "reject");
    assert.deepEqual(rejected, [], platform);
  }
});

test("每个动作：有设置项 hotkey.<动作> 和环境变量，config 列出它，默认设置下发的绑定表里有它", () => {
  const settings = resolveSettings({ file: join(ROOT, "no-such-dir", "settings.json"), env: {} });
  const listing = renderConfig(
    { settings, paths: { home: "/h", settingsFile: "/h/settings.json", logFile: "/h/main.log" } },
    { color: false, t: createTranslator("en") },
  );
  for (const platform of PLATFORMS) {
    const table = bindingTable(resolveHotkeys(settings, platform).chords, platform);
    for (const action of ACTIONS)
      assert.ok(
        table.some((row) => row.id === `${action.id}#0`),
        `${action.id} 在 ${platform} 上`,
      );
  }
  for (const action of ACTIONS) {
    const name = settingNameOf(action);
    assert.ok(Object.hasOwn(SETTINGS, name), name);
    assert.equal(SETTINGS[name].env, envOf(action));
    assert.match(listing, new RegExp(`^ {2}${name.replace(".", "\\.")}\\s`, "m"), name);
  }
});

test("每个动作：每种语言都有名字", () => {
  for (const { id, messages } of LOCALES) {
    for (const action of ACTIONS) {
      assert.equal(typeof messages.actions?.[action.id]?.name, "string", `${id} 的 actions.${action.id}.name`);
    }
  }
});

/** 一个目录下的文件，跳过 node_modules 和生成的样例 */
function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return ["node_modules", "fixtures", "build"].includes(name) ? [] : filesUnder(path);
    return [path];
  });
}

test("旧 id（right_option 这几个）只在 src/hotkeys/legacy.mjs 里出现：别处一律用组合", () => {
  // fn 这个 id 和 fn 键的键帽同字，查不出来，只查另外五个
  const ids = Object.keys(LEGACY_HOTKEYS).filter((id) => id !== "fn");
  const pattern = new RegExp(`\\b(${ids.join("|")})\\b`);
  const allowed = join(ROOT, "src/hotkeys/legacy.mjs");
  const files = [...filesUnder(join(ROOT, "src")), ...filesUnder(join(ROOT, "native"))].filter(
    (file) => /\.(mjs|cjs|html|go|swift)$/.test(file) && file !== allowed,
  );
  assert.ok(files.length > 50, `只扫到 ${files.length} 个文件，路径可能不对`);
  const found = files.filter((file) => pattern.test(readFileSync(file, "utf8"))).map((file) => relative(ROOT, file));
  assert.deepEqual(found, []);
});

test("两个小帮手的源码里不出现动作名：它们只认绑定 id 和原生码（注释和测试里举的例子不算）", () => {
  const sources = filesUnder(join(ROOT, "native")).filter(
    (file) =>
      /\.(go|swift)$/.test(file) && !/_test\.go$/.test(file) && !file.includes(`${join("native", "mac", "tests")}`),
  );
  assert.ok(sources.length >= 8, `只扫到 ${sources.length} 个文件`);
  const pattern = new RegExp(`["'](${ACTIONS.map((action) => action.id).join("|")})["'#]`);
  const found = sources
    .filter((file) => pattern.test(readFileSync(file, "utf8").replace(/\/\/[^\n]*/g, "")))
    .map((file) => relative(ROOT, file));
  assert.deepEqual(found, []);
});
