import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeImport,
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

test("规整：看不见的格式字符（零宽空格、软连字符、方向控制）也去掉：复制来的字常带，看着一样却去不了重", () => {
  assert.equal(normalizeTerm("Git\u200bHub"), "GitHub");
  assert.equal(normalizeTerm("\u2060\u00ad"), "");
  assert.equal(normalizeTerm("\u202eRunzo"), "Runzo");
});

test("导入：逗号、分号（欧洲区域的 Excel）、制表符都算列的分隔，取第一列", () => {
  assert.deepEqual(parseTermList("Runzo\t产品名\nmultica;备注\nAE-PM,说明\n").terms, ["Runzo", "multica", "AE-PM"]);
});

test("导入的文件按编码解：UTF-8（去掉 BOM）、带 BOM 的 UTF-16 两种字节序、别的按 GB18030；有 0 字节的不是文本", () => {
  assert.equal(decodeImport(Buffer.from("\uFEFF埋点")), "埋点");
  assert.equal(decodeImport(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from([0x57, 0xcb, 0x70, 0xb9])])), "埋点");
  assert.equal(decodeImport(Buffer.from([0xc2, 0xf1, 0xb5, 0xe3])), "埋点");
  assert.equal(decodeImport(Buffer.from([0x41, 0, 0x42])), null);
});
