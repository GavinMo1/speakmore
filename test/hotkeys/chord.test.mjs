import assert from "node:assert/strict";
import { test } from "node:test";
import { chordKeycaps, chordName, chordString, chordText, parseChord } from "../../src/hotkeys/chord.mjs";
import { LEGACY_HOTKEYS, legacyChord, legacyIdOf } from "../../src/hotkeys/legacy.mjs";
import { createTranslator, problemOf } from "../../src/i18n/index.mjs";

const zhMac = createTranslator("zh-CN", "darwin");
const zhWin = createTranslator("zh-CN", "win32");
const enMac = createTranslator("en", "darwin");
const enWin = createTranslator("en", "win32");

/** 写错了的话：抛出来的原因（英文） */
const reasonOf = (text) => {
  try {
    parseChord(text);
  } catch (error) {
    return enMac.text(problemOf(error));
  }
  assert.fail(`${JSON.stringify(text)} 应该不认`);
};

test("认得的形状：单个修饰键、两个修饰键、修饰键加普通键、单个 F 键或菜单键、单个 esc（5.3）", () => {
  const good = {
    AltRight: ["AltRight"],
    Fn: ["Fn"],
    MetaRight: ["MetaRight"],
    "ControlRight+ShiftRight": ["ControlRight", "ShiftRight"],
    "Fn+ShiftLeft": ["Fn", "ShiftLeft"],
    "AltRight+Space": ["AltRight", "Space"],
    "ControlRight+F13": ["ControlRight", "F13"],
    F13: ["F13"],
    F5: ["F5"],
    ContextMenu: ["ContextMenu"],
    Escape: ["Escape"],
    "AltLeft+KeyK": ["AltLeft", "KeyK"],
    "ShiftLeft+F13": ["ShiftLeft", "F13"],
  };
  for (const [text, codes] of Object.entries(good)) assert.deepEqual(parseChord(text), codes, text);
});

test("规整：修饰键在前、按 fn Control Option Shift Command 排，和写的先后无关；两边空白不算", () => {
  assert.deepEqual(parseChord("Space+AltRight"), ["AltRight", "Space"]);
  assert.deepEqual(parseChord("ShiftRight+ControlRight"), ["ControlRight", "ShiftRight"]);
  assert.deepEqual(parseChord("MetaLeft+Fn"), ["Fn", "MetaLeft"]);
  assert.deepEqual(parseChord(" AltRight + Space "), ["AltRight", "Space"]);
  assert.equal(chordString(["Space", "AltRight"]), "AltRight+Space");
  assert.equal(chordString(["ShiftLeft", "MetaLeft", "AltLeft"].slice(0, 2)), "ShiftLeft+MetaLeft");
});

test("不认的写法，各有各的原因", () => {
  const bad = {
    "": "No keys",
    "AltRight+": 'Unknown key ""',
    right_option: 'Unknown key "right_option"',
    altright: 'Unknown key "altright"',
    "AltRight+Space+KeyA": "Two keys at most",
    "AltRight+AltRight": "Right Option is listed twice",
    KeyA: "A needs a modifier: on its own it types",
    Space: "Space needs a modifier: on its own it types",
    ShiftLeft: "Shift on its own can't be a shortcut: input methods use it to switch languages",
    ShiftRight: "Shift on its own can't be a shortcut: input methods use it to switch languages",
    "KeyA+KeyS": "One of the two keys has to be a modifier",
    "F13+Space": "One of the two keys has to be a modifier",
    "AltRight+Escape": "esc can't be combined with other keys",
    "ShiftLeft+KeyA": "Shift with a typing key types capitals or symbols; pick another modifier",
    "ShiftRight+Space": "Shift with a typing key types capitals or symbols; pick another modifier",
    Enter: "Return can't be part of a shortcut",
    "AltRight+Tab": "Tab can't be part of a shortcut",
    "ControlLeft+ArrowLeft": "Left Arrow can't be part of a shortcut",
    CapsLock: "Caps Lock can't be part of a shortcut",
  };
  for (const [text, reason] of Object.entries(bad)) assert.equal(reasonOf(text), reason, JSON.stringify(text));
});

test("文字：Mac 上键帽之间空一格（右⌥ 空格），Windows 上用加号（右 Alt+空格）；单键就是键帽（5.7）", () => {
  const cases = [
    [["AltRight"], "右⌥", "右 Alt", "Right ⌥", "Right Alt"],
    [["AltRight", "Space"], "右⌥ 空格", "右 Alt+空格", "Right ⌥ Space", "Right Alt+Space"],
    [["ControlRight", "ShiftRight"], "右⌃ 右⇧", "右 Ctrl+右 Shift", "Right ⌃ Right ⇧", "Right Ctrl+Right Shift"],
    [["Fn", "ShiftLeft"], "fn 左⇧", "fn+左 Shift", "fn Left ⇧", "fn+Left Shift"],
    [["ControlRight", "F13"], "右⌃ F13", "右 Ctrl+F13", "Right ⌃ F13", "Right Ctrl+F13"],
    [["MetaLeft", "KeyK"], "左⌘ K", "左 Win+K", "Left ⌘ K", "Left Win+K"],
    [["F13"], "F13", "F13", "F13", "F13"],
    [["Escape"], "esc", "esc", "esc", "esc"],
  ];
  for (const [codes, macZh, winZh, macEn, winEn] of cases) {
    const text = chordText(codes);
    assert.deepEqual(
      [zhMac.text(text), zhWin.text(text), enMac.text(text), enWin.text(text)],
      [macZh, winZh, macEn, winEn],
    );
  }
});

test("名字（嵌进句子）：单键带“键”，两个键用加号连起来", () => {
  assert.equal(zhMac.text(chordName(["AltRight"])), "右 Option 键");
  assert.equal(zhMac.text(chordName(["AltRight", "Space"])), "右 Option+空格");
  assert.equal(zhWin.text(chordName(["ControlRight", "Space"])), "右 Ctrl+空格");
  assert.equal(enMac.text(chordName(["Fn", "Space"])), "fn+Space");
  assert.equal(zhMac.text(chordName(["F13"])), "F13 键");
  assert.equal(enWin.text(chordName(["F13"])), "F13");
});

test("键帽：一个键一个，按显示顺序", () => {
  assert.deepEqual(
    chordKeycaps(["Space", "AltRight"]).map((cap) => zhMac.text(cap)),
    ["右⌥", "空格"],
  );
  assert.deepEqual(
    chordKeycaps(["ShiftLeft", "Fn"]).map((cap) => enMac.text(cap)),
    ["fn", "Left ⇧"],
  );
});

test("六个旧键换成新写法后，名字和键帽和升级前一字不差（5.7、5.9）", () => {
  // 升级前的文案：hotkeys.<id>.name / keycap（zh-CN.mjs、en.mjs，0.13.1）
  const before = {
    right_option: ["darwin", "右 Option 键", "右⌥", "Right Option", "Right ⌥"],
    right_command: ["darwin", "右 Command 键", "右⌘", "Right Command", "Right ⌘"],
    right_control: ["darwin", "右 Control 键", "右⌃", "Right Control", "Right ⌃"],
    fn: ["darwin", "地球仪（fn）键", "fn", "Globe (fn)", "fn"],
    right_alt: ["win32", "右 Alt 键", "右 Alt", "Right Alt", "Right Alt"],
    right_ctrl: ["win32", "右 Ctrl 键", "右 Ctrl", "Right Ctrl", "Right Ctrl"],
  };
  assert.deepEqual(Object.keys(LEGACY_HOTKEYS).sort(), Object.keys(before).sort());
  for (const [id, [platform, zhName, zhCap, enName, enCap]] of Object.entries(before)) {
    const codes = parseChord(legacyChord(id));
    const zh = createTranslator("zh-CN", platform);
    const en = createTranslator("en", platform);
    assert.deepEqual(
      [zh.text(chordName(codes)), zh.text(chordText(codes)), en.text(chordName(codes)), en.text(chordText(codes))],
      [zhName, zhCap, enName, enCap],
      id,
    );
  }
});

test("旧 id 对照：认得的六个换成组合，别的是 null", () => {
  assert.equal(legacyChord("right_option"), "AltRight");
  assert.equal(legacyChord("right_command"), "MetaRight");
  assert.equal(legacyChord("right_control"), "ControlRight");
  assert.equal(legacyChord("fn"), "Fn");
  assert.equal(legacyChord("right_alt"), "AltRight");
  assert.equal(legacyChord("right_ctrl"), "ControlRight");
  assert.equal(legacyChord("AltRight"), null);
  assert.equal(legacyChord("toString"), null);
});

test("反过来：听写只绑了一个旧键时给旧 id（status --json 的旧字段，D13），按系统分；别的组合是 null", () => {
  assert.equal(legacyIdOf([["AltRight"]], "darwin"), "right_option");
  assert.equal(legacyIdOf([["AltRight"]], "win32"), "right_alt");
  assert.equal(legacyIdOf([["ControlRight"]], "darwin"), "right_control");
  assert.equal(legacyIdOf([["ControlRight"]], "win32"), "right_ctrl");
  assert.equal(legacyIdOf([["MetaRight"]], "darwin"), "right_command");
  assert.equal(legacyIdOf([["Fn"]], "darwin"), "fn");
  // Windows 上没有这两个旧 id
  assert.equal(legacyIdOf([["MetaRight"]], "win32"), null);
  assert.equal(legacyIdOf([["Fn"]], "win32"), null);
  assert.equal(legacyIdOf([["AltRight", "Space"]], "darwin"), null);
  assert.equal(legacyIdOf([["AltRight"], ["Fn"]], "darwin"), null);
  assert.equal(legacyIdOf([], "darwin"), null);
});
