import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_TERM_LENGTH,
  normalizeTerm,
  parseTermList,
  termKey,
  termLength,
  termProblem,
} from "../../src/vocabulary/terms.mjs";

test("规整：去掉首尾空白，中间连着的空白（含换行、制表）并成一个空格，控制字符去掉", () => {
  assert.equal(normalizeTerm("  Claude   Code \n"), "Claude Code");
  assert.equal(normalizeTerm("AE-PM\t\u0000"), "AE-PM");
  assert.equal(normalizeTerm("埋点"), "埋点");
});

test("词的问题：空的、太长的说出来，正常的是 null；长度按字数（码点）算，不按字节", () => {
  assert.equal(termProblem(""), "empty");
  assert.equal(termProblem("x".repeat(MAX_TERM_LENGTH)), null);
  assert.equal(termProblem("x".repeat(MAX_TERM_LENGTH + 1)), "tooLong");
  assert.equal(termProblem("喜".repeat(MAX_TERM_LENGTH)), null);
  assert.equal(termLength("😀a"), 2);
});

test("同一个词：大小写、全角半角不论（GitHub 和 github、ＡＰＩ 和 API 算重复）", () => {
  assert.equal(termKey("GitHub"), termKey("github"));
  assert.equal(termKey("ＡＰＩ"), termKey("api"));
  assert.notEqual(termKey("埋点"), termKey("埋单"));
});

test("导入：一列的 CSV 或一行一个词的文本，取每行第一列；空行跳过，文件里重复的只留第一个", () => {
  const { terms, duplicates, invalid } = parseTermList("﻿Runzo\r\nmultica,备注\n\n  Claude Code  \nmultica\nMultica\n");
  assert.deepEqual(terms, ["Runzo", "multica", "Claude Code"]);
  assert.equal(duplicates, 2);
  assert.equal(invalid, 0);
});

test("导入：带引号的第一列里可以有逗号，两个引号是一个引号；太长的词算无效、不导入", () => {
  const { terms, invalid } = parseTermList(`"Hello, World",x\n"say ""hi"""\n${"x".repeat(MAX_TERM_LENGTH + 1)}\n`);
  assert.deepEqual(terms, ["Hello, World", 'say "hi"']);
  assert.equal(invalid, 1);
});
