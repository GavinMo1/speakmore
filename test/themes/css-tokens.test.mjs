import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { THEME_CSS_VARIABLES } from "../../src/themes/contract.mjs";

// 页面的样式和主题之间的约定，机器查得了的都在这里查：颜色只从主题来，用到的变量都有出处。

const rendererDir = resolve(import.meta.dirname, "../../src/renderer");
const read = (name) => readFileSync(join(rendererDir, name), "utf8");
const files = readdirSync(rendererDir);
const sheets = files.filter((name) => name.endsWith(".css")).map((name) => ({ name, css: read(name) }));
const pages = files.filter((name) => name.endsWith(".html")).map((name) => ({ name, html: read(name) }));

const definedIn = (css) => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
const usedIn = (css) => new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1]));
const themed = new Set(THEME_CSS_VARIABLES);

test("主题给的变量，样式文件里一个都不自己定义：颜色只有主题这一个出处", () => {
  for (const { name, css } of sheets) {
    const redefined = [...definedIn(css)].filter((variable) => themed.has(variable));
    assert.deepEqual(redefined, [], name);
  }
});

test("样式里用到的每个变量都有出处：主题给的，或者样式文件自己定义的", () => {
  const local = new Set(sheets.flatMap(({ css }) => [...definedIn(css)]));
  for (const { name, css } of sheets) {
    const unknown = [...usedIn(css)].filter((variable) => !themed.has(variable) && !local.has(variable));
    assert.deepEqual(unknown, [], name);
  }
});

test("主题给的每个变量都有地方用：没有白定义的", () => {
  const used = new Set(sheets.flatMap(({ css }) => [...usedIn(css)]));
  assert.deepEqual(
    THEME_CSS_VARIABLES.filter((variable) => !used.has(variable)),
    [],
  );
});

test("样式里不写死颜色：只有阴影用的半透明黑例外", () => {
  for (const { name, css } of sheets) {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const literals =
      withoutComments.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)/gi) ?? [];
    assert.deepEqual(
      literals.filter((literal) => !/^oklch\(0 0 0 \/ [\d.]+\)$/.test(literal)),
      [],
      name,
    );
  }
});

test("每个页面都引入共用的 token，而且排在别的样式前面", () => {
  assert.ok(pages.length >= 3);
  for (const { name, html } of pages) {
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(links[0], "tokens.css", name);
  }
});
