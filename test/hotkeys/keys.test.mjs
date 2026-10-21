import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableOn,
  codeOfNative,
  isModifier,
  KEYS,
  keyOf,
  MODIFIER_ORDER,
  nativeCode,
} from "../../src/hotkeys/keys.mjs";

test("每个 code 只出现一次；同一个系统上两个键不会是同一个原生码", () => {
  const codes = KEYS.map((key) => key.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const platform of ["darwin", "win32"]) {
    for (const modifier of [true, false]) {
      const natives = KEYS.filter((key) => (key.kind === "modifier") === modifier)
        .map((key) => nativeCode(key.code, platform))
        .filter((native) => native !== null);
      assert.equal(new Set(natives).size, natives.length, `${platform} ${modifier ? "修饰键" : "别的键"}`);
    }
  }
});

test("报告 5.1 核对过的几行（Chromium dom_code_data.inc 435–446、184、187、274）", () => {
  const expected = {
    ControlLeft: [0x3b, 0x001d],
    ControlRight: [0x3e, 0xe01d],
    ShiftLeft: [0x38, 0x002a],
    ShiftRight: [0x3c, 0x0036],
    AltLeft: [0x3a, 0x0038],
    AltRight: [0x3d, 0xe038],
    MetaLeft: [0x37, 0xe05b],
    MetaRight: [0x36, 0xe05c],
    Space: [0x31, 0x0039],
    Escape: [0x35, 0x0001],
    F13: [0x69, 0x0064],
  };
  for (const [code, [mac, win]] of Object.entries(expected)) {
    assert.deepEqual([keyOf(code).mac, keyOf(code).win], [mac, win], code);
  }
});

test("fn 只有 Mac 有（kVK_Function 0x3F）；Windows 的修饰键按 vk 下发，别的键按扫描码", () => {
  assert.equal(nativeCode("Fn", "darwin"), 0x3f);
  assert.equal(nativeCode("Fn", "win32"), null);
  assert.equal(availableOn("Fn", "win32"), false);
  assert.equal(nativeCode("AltRight", "win32"), 0xa5);
  assert.equal(nativeCode("ControlRight", "win32"), 0xa3);
  assert.equal(nativeCode("Escape", "win32"), 0x01);
  assert.equal(nativeCode("F13", "win32"), 0x64);
  assert.equal(nativeCode("AltRight", "darwin"), 0x3d);
  // Mac 上没有 F21 以后的键
  assert.equal(availableOn("F21", "darwin"), false);
  assert.equal(availableOn("F21", "win32"), true);
  assert.equal(nativeCode("NoSuchKey", "darwin"), null);
});

test("原生码换回 code：修饰键和别的键分开查（Windows 上 vk 0x5B 和扫描码 0x5B 不是一个键）", () => {
  for (const platform of ["darwin", "win32"]) {
    for (const key of KEYS) {
      const native = nativeCode(key.code, platform);
      if (native === null) continue;
      assert.equal(codeOfNative(native, { platform, modifier: key.kind === "modifier" }), key.code, key.code);
    }
  }
  assert.equal(codeOfNative(0x5b, { platform: "win32", modifier: true }), "MetaLeft");
  assert.equal(codeOfNative(0x5b, { platform: "win32", modifier: false }), null);
  assert.equal(codeOfNative(0xffff, { platform: "darwin", modifier: false }), null);
});

test("修饰键都在排序表里，排序表里的都是修饰键", () => {
  const modifiers = KEYS.filter((key) => key.kind === "modifier").map((key) => key.code);
  assert.deepEqual([...MODIFIER_ORDER].sort(), [...modifiers].sort());
  assert.ok(MODIFIER_ORDER.every(isModifier));
});

test("键帽上的字和语言无关的键（字母、数字、F 键、标点）自带 label，其余的没有", () => {
  for (const key of KEYS) {
    const plain =
      /^(Key[A-Z]|Digit\d|F\d+|Minus|Equal|Bracket\w+|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash)$/;
    assert.equal(typeof key.label === "string", plain.test(key.code), key.code);
  }
  assert.equal(keyOf("KeyQ").label, "Q");
  assert.equal(keyOf("Digit0").label, "0");
});
