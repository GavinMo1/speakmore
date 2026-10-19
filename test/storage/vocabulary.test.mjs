import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createTranslator } from "../../src/i18n/index.mjs";
import { openVocabulary } from "../../src/storage/vocabulary.mjs";
import { MAX_TERM_LENGTH, MAX_TERMS } from "../../src/vocabulary/terms.mjs";

const zh = createTranslator("zh-CN");
/** 报错里给人看的那句，按中文翻出来对得上 */
const said = (pattern) => (error) => pattern.test(zh.text(error.problem ?? error.message));

let dir;
let file;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "speakmore-vocabulary-"));
  file = join(dir, "vocabulary.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const stored = () => JSON.parse(readFileSync(file, "utf8"));

test("没有文件就是空词典，不建文件", () => {
  assert.deepEqual(openVocabulary(file).terms(), []);
});

test("加词：规整后加在最前面，存成 { terms: [...] }；新开的一份读到的一样", () => {
  const vocabulary = openVocabulary(file);
  assert.equal(vocabulary.add("  Runzo "), "Runzo");
  vocabulary.add("Claude   Code");
  assert.deepEqual(vocabulary.terms(), ["Claude Code", "Runzo"]);
  assert.deepEqual(stored(), { terms: ["Claude Code", "Runzo"] });
  assert.deepEqual(openVocabulary(file).terms(), ["Claude Code", "Runzo"]);
});

test("加词：空的、太长的、已经有的（大小写不论）说清楚，不改文件", () => {
  const vocabulary = openVocabulary(file);
  vocabulary.add("GitHub");
  assert.throws(() => vocabulary.add("   "), said(/请输入/));
  assert.throws(() => vocabulary.add("x".repeat(MAX_TERM_LENGTH + 1)), said(new RegExp(`${MAX_TERM_LENGTH}`)));
  assert.throws(() => vocabulary.add("github"), said(/GitHub.*已在词典中/));
  assert.deepEqual(stored(), { terms: ["GitHub"] });
});

test("加词：满了就不加，说清上限", () => {
  writeFileSync(file, JSON.stringify({ terms: Array.from({ length: MAX_TERMS }, (_, i) => `t${i}`) }));
  assert.throws(() => openVocabulary(file).add("one more"), said(new RegExp(`${MAX_TERMS}`)));
});

test("改词：位置不变；改成别的已有词算重复；只改大小写可以；原来的词不在了说清楚", () => {
  const vocabulary = openVocabulary(file);
  for (const term of ["c", "b", "a"]) vocabulary.add(term);
  assert.equal(vocabulary.update("b", "Bee"), "Bee");
  assert.deepEqual(vocabulary.terms(), ["a", "Bee", "c"]);
  assert.throws(() => vocabulary.update("Bee", "A"), said(/已在词典中/));
  assert.equal(vocabulary.update("Bee", "BEE"), "BEE");
  assert.throws(() => vocabulary.update("zzz", "y"), said(/zzz/));
});

test("删词：一次删几个，按大小写不论认，回删了几个；不在的不算", () => {
  const vocabulary = openVocabulary(file);
  for (const term of ["c", "b", "a"]) vocabulary.add(term);
  assert.equal(vocabulary.remove(["A", "c", "nope"]), 2);
  assert.deepEqual(vocabulary.terms(), ["b"]);
});

test("导入：先预览（去掉词典里已有的），再按文件里的先后加在最前面", () => {
  const vocabulary = openVocabulary(file);
  vocabulary.add("multica");
  const preview = vocabulary.preview("Runzo\nMultica\nAE-PM\nRunzo\n");
  assert.deepEqual(preview.terms, ["Runzo", "AE-PM"]);
  assert.equal(preview.duplicates, 2);
  assert.equal(preview.room, MAX_TERMS - 1);
  assert.equal(vocabulary.importTerms(preview.terms), 2);
  assert.deepEqual(vocabulary.terms(), ["Runzo", "AE-PM", "multica"]);
});

test("导入：超出上限的整批不导，说清还能加几个；导入时又有重复的（两次导入之间加过）跳过", () => {
  const vocabulary = openVocabulary(file);
  writeFileSync(file, JSON.stringify({ terms: Array.from({ length: MAX_TERMS - 1 }, (_, i) => `t${i}`) }));
  assert.throws(() => vocabulary.importTerms(["x", "y"]), said(/还能添加 1 个/));
  assert.equal(vocabulary.importTerms(["t0", "x"]), 1);
});

test("别处改了文件（命令行、手改）下一次读就是新的；手改的词照样规整、去重，空的丢掉", () => {
  const vocabulary = openVocabulary(file);
  vocabulary.add("a");
  writeFileSync(file, JSON.stringify({ terms: ["  Runzo ", "runzo", "", "埋点"] }));
  assert.deepEqual(vocabulary.terms(), ["Runzo", "埋点"]);
});

test("文件坏了照实报错，说是哪个文件；不当成空词典、也不覆盖它", () => {
  writeFileSync(file, "{ not json");
  const vocabulary = openVocabulary(file);
  assert.throws(() => vocabulary.terms(), said(/vocabulary\.json/));
  assert.throws(() => vocabulary.add("a"), said(/vocabulary\.json/));
  assert.equal(readFileSync(file, "utf8"), "{ not json");
  writeFileSync(file, JSON.stringify({ terms: "a,b" }));
  assert.throws(() => openVocabulary(file).terms(), said(/vocabulary\.json/));
});
