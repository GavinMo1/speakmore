#!/usr/bin/env node
// 把热键的按键轨迹样例（native/fixtures/hotkeys/*.json，键写 code 名）按键表换成两个系统的原生码，
// 写进 native/fixtures/hotkeys/mac/、win/。Go 和 Swift 的测试读得了的只有这两份（键表在 JS 里）。
//   node scripts/build/hotkey-fixtures.mjs
// 写法见 native/fixtures/hotkeys/README.md；test/scripts/build/hotkey-fixtures.test.mjs 核对生成的和仓库里的一致。

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChord } from "../../src/hotkeys/chord.mjs";
import { isModifier, keyOf, nativeCode } from "../../src/hotkeys/keys.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const FIXTURES = join(ROOT, "native/fixtures/hotkeys");
const OUTPUT = { darwin: "mac", win32: "win" };

function nativeOf(code, platform, where) {
  const native = nativeCode(code, platform);
  if (native === null) throw new Error(`${where}：${platform} 上没有 ${code}`);
  return native;
}

function bindingsFor(bindings, platform, where) {
  return bindings.map(({ id, chord, when = "always" }) => {
    const codes = parseChord(chord);
    const mods = codes.filter(isModifier).map((code) => nativeOf(code, platform, where));
    const key = codes.find((code) => !isModifier(code));
    return { id, when, mods, key: key === undefined ? null : nativeOf(key, platform, where) };
  });
}

/** 事件的简写换成小帮手真正报的那一行 */
function expand(event) {
  if (event.down !== undefined) return { event: "binding", id: event.down, down: true };
  if (event.up !== undefined) return { event: "binding", id: event.up, down: false };
  if (event.interrupted !== undefined) {
    return event.to === undefined
      ? { event: "interrupted", id: event.interrupted }
      : { event: "interrupted", id: event.interrupted, to: event.to };
  }
  throw new Error(`认不出的事件 ${JSON.stringify(event)}`);
}

/** 一个按键事件在这个系统上长什么样 */
function keyEvent(step, platform, where) {
  if (keyOf(step.key) === null) throw new Error(`${where}：不认识的键 ${step.key}`);
  const native = nativeOf(step.key, platform, where);
  const modifier = isModifier(step.key);
  if (platform === "darwin") return { code: native, modifier };
  // Windows：修饰键按 vk 认；别的键按扫描码认，带 0xE0 前缀的是扩展键（钩子里是 LLKHF_EXTENDED）。
  // 别的键的 vk 小帮手用不上，样例里写 0，免得实现偷偷依赖它
  const scan = modifier ? keyOf(step.key).win : native;
  return {
    vk: modifier ? native : 0,
    scan: step.scan ?? scan & 0xff,
    extended: step.scan === undefined && scan >> 8 === 0xe0,
  };
}

function convertCase(entry, platform, file) {
  const where = `${file}「${entry.name}」`;
  let t = 0;
  const steps = [];
  for (const step of entry.steps) {
    if (step.only !== undefined && step.only !== platform) continue;
    const expect = { events: (step.events ?? []).map(expand), swallow: step.swallow ?? false };
    if (platform === "win32") expect.mask = step.mask ?? false;
    if (step.key !== undefined) {
      t = step.t ?? t + 1;
      steps.push({ ...keyEvent(step, platform, where), down: step.down, injected: step.injected ?? false, t, expect });
    } else if (step.capture !== undefined) {
      steps.push({ capture: step.capture, expect });
    } else if (step.lostUp !== undefined) {
      steps.push({ lostUp: keyEvent({ key: step.lostUp }, platform, where), expect });
    } else if (step.reset !== undefined) {
      steps.push({ reset: true, expect });
    } else if (step.bind !== undefined) {
      steps.push({ bind: bindingsFor(step.bind, platform, where), expect });
    } else {
      throw new Error(`${where}：认不出的一步 ${JSON.stringify(step)}`);
    }
  }
  return { name: entry.name, bindings: bindingsFor(entry.bindings, platform, where), steps };
}

/** 生成的全部文件：路径（相对 FIXTURES）→ 内容 */
export function generate() {
  const files = new Map();
  for (const file of readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const { cases } = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
    for (const platform of ["darwin", "win32"]) {
      const converted = cases
        .filter((entry) => (entry.platforms ?? ["darwin", "win32"]).includes(platform))
        .map((entry) => convertCase(entry, platform, file));
      if (converted.length === 0) continue;
      files.set(join(OUTPUT[platform], file), `${JSON.stringify({ cases: converted }, null, 2)}\n`);
    }
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, content] of generate()) {
    const target = join(FIXTURES, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    console.log(`写好 ${join("native/fixtures/hotkeys", path)}`);
  }
}
