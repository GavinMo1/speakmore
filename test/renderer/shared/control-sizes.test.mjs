import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// 界面规范的尺寸（docs/desktop-ui-spec.md 第 2 节）：控件高度三档（--control-sm/md/lg），圆角四档（--radius-*）。
// 一行里的按钮、徽标高矮不一，多半是谁顺手写了个 30px，所以由测试守着，做法同字号的测试（type-scale.test.mjs）。

const RENDERER = join(import.meta.dirname, "../../../src/renderer");

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

/** 一个样式文件里的规则：选择器、声明、起始行号。只拆平铺的规则，@media / @container 里的也照样拆出来 */
function rules(path) {
  const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const found = [];
  for (const match of css.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const line = css.slice(0, match.index).split("\n").length;
    found.push({
      selector: match[1].trim(),
      body: match[2],
      at: `${relative(RENDERER, path).replaceAll("\\", "/")}:${line}`,
    });
  }
  return found;
}

/** 规范里的控件：它们的高度只能是三档之一。只看选择器最后那一段（.button .icon 说的是按钮里的图标，不是按钮） */
const CONTROL = /\.(button|input|select|badge|check|pill|tab|segmented|state-box|toggle|icon-button)(?![\w-])/;
const isControl = (selector) =>
  selector.split(",").some((part) =>
    CONTROL.test(
      part
        .trim()
        .split(/\s*[\s>+~]\s*/)
        .pop(),
    ),
  );

test("控件的高度只用 --control-sm / md / lg", () => {
  const offenders = cssFiles(RENDERER)
    .flatMap(rules)
    .filter(({ selector }) => isControl(selector))
    .flatMap(({ selector, body, at }) =>
      [...body.matchAll(/(?:^|;)\s*height:\s*([^;]+)/g)]
        .map(([, value]) => value.trim())
        .filter((value) => !/^var\(--control-(sm|md|lg)\)$/.test(value))
        .map((value) => `${at}  ${selector} { height: ${value} }`),
    );
  assert.deepEqual(offenders, []);
});

/**
 * 不走圆角四档的例外，各有缘由：都是装饰性的细线、小格子，或者悬浮条自己的形状（它不是普通窗口，不套窗口的规范）
 */
/** 一个角的圆角：token、全圆、直角，或者 token 算出来的 */
const RADIUS_VALUE = /^(50%|0|var\(--radius-[a-z]+\)|calc\(var\(--radius-[a-z]+\)[^)]*\))$/;

const RADIUS_EXCEPTIONS = [
  ["bar/", "悬浮条自己的形状和电平条"],
  ["hub/hub.css:.cell", "首页活跃度热力图的小格子"],
  ["hub/hub.css:.page-arrow", "热力图翻页的小箭头"],
];

test("圆角只用 --radius-*（或者全圆的 50%），例外都写明了缘由", () => {
  const offenders = cssFiles(RENDERER)
    .flatMap(rules)
    .flatMap(({ selector, body, at }) =>
      [...body.matchAll(/(?:^|;)\s*border-radius:\s*([^;]+)/g)]
        .map(([, value]) => value.trim())
        .filter((value) => !value.split(/\s+(?![^(]*\))/).every((part) => RADIUS_VALUE.test(part)))
        .map((value) => ({ at, selector, value })),
    )
    .filter(
      ({ at, selector }) =>
        !RADIUS_EXCEPTIONS.some(([where]) =>
          where.endsWith("/") ? at.startsWith(where) : `${at.split(":")[0]}:${selector}` === where,
        ),
    )
    .map(({ at, selector, value }) => `${at}  ${selector} { border-radius: ${value} }`);
  assert.deepEqual(offenders, []);
});

/**
 * 按钮一类的东西：外形一律是胶囊（全圆）。只看选择器最后那一段，同上；
 * 伪元素是它的一部分（下拉框打开后的单子 ::picker），不算
 */
const CAPSULE = /\.(button|icon-button|select|picker-trigger|state-box|check|badge)(?![\w-])/;
const isCapsule = (selector) =>
  selector.split(",").some((part) => {
    const last = part
      .trim()
      .split(/\s*[\s>+~]\s*/)
      .pop();
    return CAPSULE.test(last) && !last.includes("::");
  });

test("按钮一类的（按钮、图标按钮、下拉框、胶囊按钮、状态框、检测、徽标）写圆角时只能是全圆", () => {
  const offenders = cssFiles(RENDERER)
    .filter((path) => !relative(RENDERER, path).replaceAll("\\", "/").startsWith("bar/"))
    .flatMap(rules)
    .filter(({ selector }) => isCapsule(selector))
    .flatMap(({ selector, body, at }) =>
      [...body.matchAll(/(?:^|;)\s*border-radius:\s*([^;]+)/g)]
        .map(([, value]) => value.trim())
        .filter((value) => value !== "var(--radius-full)")
        .map((value) => `${at}  ${selector} { border-radius: ${value} }`),
    );
  assert.deepEqual(offenders, []);
});

test("查得到违规的写法：控件认得准，写死的圆角认得出", () => {
  assert.ok(isControl(".row .button.block"));
  assert.ok(isControl(".search .input"));
  assert.ok(!isControl(".button .icon"));
  assert.ok(!isControl(".buttons-row"));
  assert.ok(!isControl(".tabs"));
  assert.ok(isCapsule(".zoom .icon-button"));
  assert.ok(isCapsule("#mode-chip.picker-trigger"));
  assert.ok(!isCapsule(".vocab-check"));
  assert.ok(!isCapsule(".picker-trigger > .chevron"));
  assert.ok(!isCapsule(".select::picker(select)"));
  assert.ok(RADIUS_VALUE.test("var(--radius-card)"));
  assert.ok(!RADIUS_VALUE.test("6px"));
});
