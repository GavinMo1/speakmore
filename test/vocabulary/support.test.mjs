import assert from "node:assert/strict";
import { test } from "node:test";
import { fitTerms, PROMPT_VOCABULARY, VOCABULARY_KINDS, vocabularySupport } from "../../src/vocabulary/support.mjs";

test("做法只有三种：写进提示词、作为上下文、热词；写错了当场报错", () => {
  assert.deepEqual(VOCABULARY_KINDS, ["prompt", "context", "hotwords"]);
  assert.throws(() => vocabularySupport("magic"), /magic/);
  assert.equal(vocabularySupport("hotwords", { maxTerms: 100 }).kind, "hotwords");
});

test("挑词：按词典的先后挑，超过个数就停", () => {
  const support = vocabularySupport("hotwords", { maxTerms: 2 });
  assert.deepEqual(fitTerms(["a", "b", "c"], support), ["a", "b"]);
});

test("挑词：总字数（词之间算一个分隔）放不下的跳过，后面短的还能放就放", () => {
  const support = vocabularySupport("context", { maxChars: 7 });
  // "abc" 3 + 分隔 1 + "defgh" 5 = 9 放不下；"abc" + "de" = 6 放得下
  assert.deepEqual(fitTerms(["abc", "defgh", "de"], support), ["abc", "de"]);
});

test("挑词：这一家不收的词（accepts 说不行）跳过，不占个数", () => {
  const support = vocabularySupport("hotwords", { maxTerms: 2, accepts: (term) => !term.includes(",") });
  assert.deepEqual(fitTerms(["a,b", "c", "d", "e"], support), ["c", "d"]);
});

test("挑词：词典是空的、或者模型不收词表（support 是 null）时一个都不送", () => {
  assert.deepEqual(fitTerms([], PROMPT_VOCABULARY), []);
  assert.deepEqual(fitTerms(["a"], null), []);
});

test("大模型的提示词有上限，免得每次听写的提示词无限变长", () => {
  assert.equal(PROMPT_VOCABULARY.kind, "prompt");
  assert.ok(Number.isFinite(PROMPT_VOCABULARY.maxTerms));
  assert.ok(Number.isFinite(PROMPT_VOCABULARY.maxChars));
  const many = Array.from({ length: 2000 }, (_, i) => `term${i}`);
  assert.equal(fitTerms(many, PROMPT_VOCABULARY).length, PROMPT_VOCABULARY.maxTerms);
});
