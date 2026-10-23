import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// 首次引导的功能演示里嵌着悬浮条、划词卡片（onboarding/demo/）：样式、画法用的是真的，页面的骨架是照抄的。
// 真页面改了骨架（加了一块、换了 id）演示不会报错，只会悄悄画错，所以由测试逐字对着：除了脚本那一行，body 要一模一样。

const RENDERER = join(import.meta.dirname, "../../../src/renderer");
const body = (path) =>
  readFileSync(join(RENDERER, path), "utf8")
    .match(/<body[\s\S]*<\/body>/)[0]
    .replace(/<script type="module" src="[^"]+"><\/script>/, "");

for (const [demo, real] of [
  ["onboarding/demo/bar.html", "bar/bar.html"],
  ["onboarding/demo/card.html", "lookup/card.html"],
]) {
  test(`${demo} 的骨架和 ${real} 一样`, () => {
    assert.equal(body(demo), body(real));
  });
}
