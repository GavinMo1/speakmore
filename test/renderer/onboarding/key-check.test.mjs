import assert from "node:assert/strict";
import { test } from "node:test";
import { actionOfChord, createGesture, helperPassed } from "../../../src/renderer/onboarding/key-check.mjs";

const ACTIONS = [
  { id: "dictate", inEffect: [["AltRight"]] },
  { id: "translate", inEffect: [["AltRight", "Space"]] },
  { id: "lookup", inEffect: [["AltRight", "Enter"], ["F13"]] },
  { id: "cancel", inEffect: [["Escape"]] },
];

test("一下手势：从按下第一个键到全部松开，按过的键都算；没松完不出结果", () => {
  const gesture = createGesture();
  gesture.down("AltRight");
  gesture.down("Space");
  assert.equal(gesture.up("Space"), null);
  assert.deepEqual(gesture.up("AltRight"), ["AltRight", "Space"]);
  assert.equal(gesture.held.size, 0);
});

test("松开了没按过的键（窗口外按下、切回来才松开）不出结果", () => {
  const gesture = createGesture();
  assert.equal(gesture.up("AltRight"), null);
});

test("切走窗口时清掉：按着的当松开，这一下作废", () => {
  const gesture = createGesture();
  gesture.down("AltRight");
  gesture.reset();
  assert.equal(gesture.held.size, 0);
  gesture.down("Enter");
  assert.deepEqual(gesture.up("Enter"), ["Enter"]);
});

test("按集合精确匹配功能的组合：不分先后，几个组合哪个都算，多一个键少一个键都不算", () => {
  assert.equal(actionOfChord(ACTIONS, ["AltRight"]), "dictate");
  assert.equal(actionOfChord(ACTIONS, ["Space", "AltRight"]), "translate");
  assert.equal(actionOfChord(ACTIONS, ["F13"]), "lookup");
  assert.equal(actionOfChord(ACTIONS, ["AltRight", "Space", "Enter"]), null);
  assert.equal(actionOfChord(ACTIONS, ["Space"]), null);
});

test("只认三个功能：取消键不算", () => {
  assert.equal(actionOfChord(ACTIONS, ["Escape"]), null);
});

test("小帮手转来的：功能的组合松开了、中间没被打断，才算按到", () => {
  assert.equal(helperPassed({ action: "dictate", event: "binding", down: false }), "dictate");
  assert.equal(helperPassed({ action: "dictate", event: "binding", down: true }), null);
  // 右⌥ 之后按了空格：先报语音输入被打断，再报语音翻译按下、松开
  assert.equal(helperPassed({ action: "dictate", event: "interrupted", down: false }), null);
  assert.equal(helperPassed({ action: "cancel", event: "binding", down: false }), null);
});
