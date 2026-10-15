import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// 官网不提 Typeless：不比价、不链逆向笔记、不写"无关联"的声明（他 2026-10-15 定的）。
// 查的是会进页面的东西：源码、文案、入口页
test("官网的源码和文案里没有 Typeless", () => {
  const root = new URL("../", import.meta.url).pathname;
  const files = [
    "index.html",
    ...readdirSync(join(root, "src"), { recursive: true })
      .filter((file) => /\.(jsx?|json|css)$/.test(file) && file !== join("icons", "data.js"))
      .map((file) => join("src", file)),
  ];
  const hits = files.filter((file) => /typeless/i.test(readFileSync(join(root, file), "utf8")));
  assert.deepEqual(hits, []);
});
