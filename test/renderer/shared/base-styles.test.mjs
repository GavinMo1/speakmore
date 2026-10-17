import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// 窗口共用的底子（shared/window.css）。2026-10-17 首页"今天 / 本月 / 累计"的样式在重做模型页时被删掉，
// 按钮退回成浏览器自带的灰色系统按钮，没人发现；"获取密钥"也是同一类。所以按钮先统一去掉自带的外观：
// 样式漏了的按钮退回的是一段平的字，不会再冒出灰底凸边的系统按钮。这条规矩由这个测试守着。

const css = readFileSync(join(import.meta.dirname, "../../../src/renderer/shared/window.css"), "utf8");

test("按钮先去掉浏览器自带的外观，而且不占优先级（规范里的各种按钮照样盖得住）", () => {
  const rule = css.match(/:where\(button\)\s*\{([^}]*)\}/);
  assert.ok(rule, "window.css 里要有 :where(button) { … }");
  for (const declaration of ["background: none", "border: none", "font: inherit", "color: inherit"]) {
    assert.ok(rule[1].includes(declaration), `少了 ${declaration}`);
  }
});
