import assert from "node:assert/strict";
import { test } from "node:test";
import { hotkeyText } from "../../../src/renderer/shared/i18n.mjs";

// 页面以外没有 window：按默认语言（英文）、按本机这个系统的说法翻

test("一个动作的热键写成什么：几个组合任一个都行，按“或”并列", () => {
  assert.equal(hotkeyText([["Fn"]]), "fn");
  assert.equal(hotkeyText([["Fn"], ["F13"]]), "fn or F13");
});
