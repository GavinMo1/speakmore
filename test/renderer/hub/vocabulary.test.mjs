import assert from "node:assert/strict";
import { test } from "node:test";
import { limitText, matchTerms } from "../../../src/renderer/hub/vocabulary.mjs";

test("词典页的搜索：大小写、全角半角不论，包含就算；空的搜索全给", () => {
  const terms = ["Claude Code", "埋点", "ＡＰＩ"];
  assert.deepEqual(matchTerms(terms, "claude"), ["Claude Code"]);
  assert.deepEqual(matchTerms(terms, "api"), ["ＡＰＩ"]);
  assert.deepEqual(matchTerms(terms, "  "), terms);
});

test("收多少写成一句：有个数写个数，只有字数写字数，都不限是 null", () => {
  assert.match(limitText({ kind: "hotwords", maxTerms: 100, maxChars: null }), /100/);
  assert.match(limitText({ kind: "hotwords", maxTerms: null, maxChars: 600 }), /600/);
  assert.equal(limitText({ kind: "hotwords", maxTerms: null, maxChars: null }), null);
  assert.equal(limitText(null), null);
});
