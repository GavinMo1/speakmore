import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import en from "../src/i18n/en.js";
import zh from "../src/i18n/zh-CN.js";
import { cutMarks } from "../src/lib/text.js";

/** 两份文案的结构：每个键、数组的长度、值的类型，以及每句话里的 {占位} */
function shape(value) {
  if (Array.isArray(value)) return value.map(shape);
  if (value === null) return null;
  if (typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]));
  if (typeof value === "string") return `string ${[...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()}`;
  return typeof value;
}

test("中英文案的结构一一对应：键、数组长度、占位都一样", () => {
  assert.deepEqual(shape(zh), shape(en));
});

test("没有空着的文案", () => {
  const walk = (value, path) => {
    if (typeof value === "string") assert.notEqual(value.trim(), "", `${path} 是空的`);
    else if (value && typeof value === "object")
      for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
  };
  walk(en, "en");
  walk(zh, "zh-CN");
});

test("演示里的口述标记成对，删掉的部分不是整句", () => {
  for (const messages of [en, zh]) {
    for (const { said } of messages.demo.examples) {
      const parts = cutMarks(said);
      assert.ok(parts.some((part) => part.cut));
      assert.ok(parts.some((part) => !part.cut));
    }
  }
});

test("页面里读的文案都有：两份一起漏了同一段时，结构对得上也查不出来", () => {
  const dir = new URL("../src/", import.meta.url).pathname;
  const files = readdirSync(dir, { recursive: true }).filter((file) => file.endsWith(".jsx"));
  const missing = [];
  for (const file of files) {
    const source = readFileSync(join(dir, file), "utf8");
    for (const [, path] of source.matchAll(/\bm\.(\w+(?:\.\w+)*)/g)) {
      let value = en;
      for (const key of path.split(".")) {
        // 读到字或数组就停：后面是 .join、.length 这些
        if (typeof value !== "object" || Array.isArray(value)) break;
        value = value[key];
        if (value === undefined) {
          missing.push(`${file}: m.${path}`);
          break;
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});
