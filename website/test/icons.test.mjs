import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { icons } from "../src/icons/data.js";

test("图标里引用的 id 都在同一个图标里，并且带着图标自己的前缀（同页画两个不撞）", () => {
  for (const [name, { body }] of Object.entries(icons)) {
    const ids = new Set([...body.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
    for (const id of ids) assert.ok(id.startsWith(`${name}-`), `${name} 里的 id ${id} 没加前缀`);
    for (const [, ref] of body.matchAll(/(?:url\(#|href="#)([^)"]+)/g))
      assert.ok(ids.has(ref), `${name} 引用了不存在的 #${ref}`);
  }
});

/** 页面里用到的图标名：<Icon name="…">、文案和组件里的 icon: "…" */
function usedIcons() {
  const dir = new URL("../src/", import.meta.url).pathname;
  const files = readdirSync(dir, { recursive: true }).filter((file) => file.endsWith(".jsx") || file.endsWith(".js"));
  const used = new Set();
  for (const file of files) {
    const source = readFileSync(join(dir, file), "utf8");
    for (const [, name] of source.matchAll(/<Icon name="(\w+)"/g)) used.add(name);
    // name={copied ? "check" : "copy"} 这种二选一
    for (const [, expression] of source.matchAll(/<Icon name=\{([^}]+)\}/g))
      for (const [, name] of expression.matchAll(/"(\w+)"/g)) used.add(name);
    for (const [, name] of source.matchAll(/icon: "(\w+)"/g)) used.add(name);
  }
  return used;
}

test("页面用到的图标都生成了", () => {
  const missing = [...usedIcons()].filter((name) => !(name in icons));
  assert.deepEqual(missing, []);
});

test("生成了的图标都用到了：不用的图标会打进页面，删段落时要跟着从 scripts/icons.mjs 里删", () => {
  const used = usedIcons();
  const unused = Object.keys(icons).filter((name) => !used.has(name));
  assert.deepEqual(unused, []);
});
