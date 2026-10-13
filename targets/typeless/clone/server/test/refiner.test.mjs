import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_SPEECH_MARK, SYSTEM_PROMPT } from "../src/prompt.mjs";
import { textFromModelOutput } from "../src/refiner.mjs";

test("提示词里写的无人声标记，和代码里判断的是同一个", () => {
  assert.ok(SYSTEM_PROMPT.includes(`只输出 ${NO_SPEECH_MARK}，`));
});

test("模型输出无人声标记或什么都没输出时，成品是空字符串", () => {
  assert.equal(textFromModelOutput(NO_SPEECH_MARK), "");
  assert.equal(textFromModelOutput(` ${NO_SPEECH_MARK}\n`), "");
  assert.equal(textFromModelOutput(undefined), "");
  assert.equal(textFromModelOutput("  "), "");
});

test("正常的文字只去掉首尾空白；用户真的说到了这个标记时不误删", () => {
  assert.equal(textFromModelOutput(" 我们后天开会。\n"), "我们后天开会。");
  assert.equal(textFromModelOutput(`标记是 ${NO_SPEECH_MARK} 这几个字`), `标记是 ${NO_SPEECH_MARK} 这几个字`);
});
