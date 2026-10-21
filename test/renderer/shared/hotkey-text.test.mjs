import assert from "node:assert/strict";
import { test } from "node:test";
import { hotkeyOptions, hotkeyText } from "../../../src/renderer/shared/i18n.mjs";

// 页面以外没有 window：按默认语言（英文）、按本机这个系统的说法翻

test("一个动作的热键写成什么：几个组合任一个都行，按“或”并列", () => {
  assert.equal(hotkeyText([["Fn"]]), "fn");
  assert.equal(hotkeyText([["Fn"], ["F13"]]), "fn or F13");
});

test("热键下拉框：能选的单键各一项；装着的不在其中（命令行设的组合）时排在最前、选中它", () => {
  const choices = ["ControlRight", "AltRight"];
  assert.deepEqual(hotkeyOptions({ value: [["AltRight"]], choices }).current, "AltRight");
  assert.deepEqual(
    hotkeyOptions({ value: [["AltRight"]], choices }).options.map(([value]) => value),
    ["ControlRight", "AltRight"],
  );
  const combo = hotkeyOptions({ value: [["Fn"], ["AltRight", "Space"]], choices });
  assert.equal(combo.current, '["Fn","AltRight+Space"]');
  assert.deepEqual(combo.options[0], ['["Fn","AltRight+Space"]', hotkeyText([["Fn"], ["AltRight", "Space"]])]);
  assert.equal(combo.options.length, 3);
});
