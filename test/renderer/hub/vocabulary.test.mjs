import assert from "node:assert/strict";
import { test } from "node:test";
import { limitDetail, limitText, matchTerms } from "../../../src/renderer/hub/vocabulary.mjs";
import { t } from "../../../src/renderer/shared/i18n.mjs";

test("词典页的搜索：大小写、全角半角不论，包含就算；空的搜索全给", () => {
  const terms = ["Claude Code", "埋点", "ＡＰＩ"];
  assert.deepEqual(matchTerms(terms, "claude"), ["Claude Code"]);
  assert.deepEqual(matchTerms(terms, "api"), ["ＡＰＩ"]);
  assert.deepEqual(matchTerms(terms, "  "), terms);
});

test("收多少写成一个短语：个数比词典的上限少才写个数，再看总字数，都不限是全收；不收是 null", () => {
  assert.match(limitText({ kind: "hotwords", maxTerms: 100, maxChars: null }), /100/);
  assert.match(limitText({ kind: "hotwords", maxTerms: null, maxChars: 600 }), /600/);
  // 2000 个比词典最多的 1000 个还多，等于全收：看后面的
  assert.match(limitText({ kind: "hotwords", maxTerms: 2000, maxChars: 600 }), /600/);
  assert.equal(limitText({ kind: "hotwords", maxTerms: 2000, maxChars: null }), t("vocabulary.support.limitAll"));
  assert.equal(limitText(null), null);
});

test("全部的上限悬停时看：个数、总字数、单个词的长度各一行，不收的是空的", () => {
  const detail = limitDetail({ kind: "prompt", maxTerms: 300, maxChars: 3000, maxTermChars: 15, maxTermWords: 7 });
  assert.deepEqual(
    detail.split("\n").map((line) => line.replaceAll(",", "").match(/\d+/)[0]),
    ["300", "3000", "15", "7"],
  );
  assert.equal(limitDetail({ kind: "hotwords", maxTerms: 2000, maxChars: null }), "");
  assert.equal(limitDetail(null), "");
});
