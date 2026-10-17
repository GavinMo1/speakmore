import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import {
  APP_ENTRIES,
  findCopyleft,
  MAC_APP_IGNORE,
  pruneUnused,
  UNUSED_PACKAGES,
} from "../../../scripts/build/stage-app.mjs";

const repoDir = resolve(import.meta.dirname, "../../..");

/** 在临时目录里摆一个假的 node_modules：名字 → 许可证 */
function fakeModules(t, packages) {
  const dir = mkdtempSync(join(tmpdir(), "sm-stage-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, license] of Object.entries(packages)) {
    mkdirSync(join(dir, "node_modules", name), { recursive: true });
    const own = name.split("/node_modules/").at(-1);
    const manifest = license === undefined ? { name: own } : { name: own, license };
    writeFileSync(join(dir, "node_modules", name, "package.json"), JSON.stringify(manifest));
  }
  return dir;
}

test("用不到的解码器从发布包里删掉，只留 WebM 那一个；拆 Ogg 的 codec-parser（LGPL）也删", (t) => {
  const dir = fakeModules(t, {
    "@audio/decode-webm": "MIT",
    "@audio/decode-opus": "MIT",
    "@audio/decode-aac": "GPL-2.0",
    "@audio/decode-eac3": "LGPL-2.1-or-later",
    "codec-parser": "LGPL-3.0-or-later",
  });
  pruneUnused(dir);
  assert.ok(existsSync(join(dir, "node_modules", "@audio/decode-webm")));
  for (const name of ["@audio/decode-opus", "@audio/decode-aac", "@audio/decode-eac3", "codec-parser"]) {
    assert.ok(!existsSync(join(dir, "node_modules", name)), name);
  }
  assert.ok(!UNUSED_PACKAGES.includes("@audio/decode-webm"));
});

test("发布包里有 GPL 一类许可证的包时指出来；MIT、Apache、ISC、BSD 不算", (t) => {
  const dir = fakeModules(t, {
    ws: "MIT",
    "@google/genai": "Apache-2.0",
    "some-isc": "ISC",
    "bsd-thing": "BSD-3-Clause",
    "@audio/decode-aac": "GPL-2.0",
    "lgpl-thing": "LGPL-2.1-or-later",
    "agpl-thing": "AGPL-3.0-only",
    "either-way": "(MIT OR GPL-3.0)",
  });
  assert.deepEqual(
    findCopyleft(join(dir, "node_modules")).sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "@audio/decode-aac", license: "GPL-2.0" },
      { name: "agpl-thing", license: "AGPL-3.0-only" },
      { name: "lgpl-thing", license: "LGPL-2.1-or-later" },
    ],
  );
});

test("嵌套的 node_modules 也查；没写许可证的不放过，当成要人看一眼的", (t) => {
  const dir = fakeModules(t, { outer: "MIT", "outer/node_modules/inner": "GPL-3.0", unlicensed: undefined });
  assert.deepEqual(
    findCopyleft(join(dir, "node_modules"))
      .map(({ name }) => name)
      .sort(),
    ["inner", "unlicensed"],
  );
});

test("程序按相对路径用到的仓库文件都存在，并且在打包会摆进去的目录里", () => {
  const srcDir = join(repoDir, "src");
  const outside = [];
  for (const file of readdirSync(srcDir, { recursive: true })) {
    if (!/\.(mjs|html|css)$/.test(file)) continue;
    const text = readFileSync(join(srcDir, file), "utf8");
    for (const [, path] of text.matchAll(/["'(]((?:\.\.\/)+[^"')\s]+)["')]/g)) {
      const target = resolve(dirname(join(srcDir, file)), path);
      assert.ok(existsSync(target), `${file} 用到的 ${path} 不存在`);
      // src 里面的不用查；指向程序根目录本身的（命令行找自己装在哪）也不算
      if (target === repoDir || target.startsWith(srcDir + sep)) continue;
      outside.push({ file, top: relative(repoDir, target).split(sep)[0] });
    }
  }
  for (const { file, top } of outside) assert.ok(APP_ENTRIES.includes(top), `${file} 用到了 ${top}/，打包时没带上它`);
  assert.ok(
    outside.some(({ top }) => top === "assets"),
    "菜单栏和窗口的图标从 assets/ 读",
  );
});

/** 一个文件里按相对路径引用的模块：import / export … from、import "…"、import("…")、require("…")、new URL("…", import.meta.url) */
function relativeSpecifiers(source) {
  const patterns = [
    /\b(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
    /\bnew URL\(\s*["'](\.{1,2}\/[^"']+)["']\s*,\s*import\.meta\.url/g,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]));
}

test("装进 Mac 应用的代码，引用的文件都在应用里：没被打包时剔掉（0.9.0、0.9.1 的主进程引用了 src/cli，App 一启动就报找不到模块）", () => {
  const shipped = (path) => !MAC_APP_IGNORE.some((pattern) => pattern.test(`/${path}`));
  const broken = [];
  for (const entry of APP_ENTRIES) {
    if (!existsSync(join(repoDir, entry))) continue;
    for (const file of readdirSync(join(repoDir, entry), { recursive: true })) {
      const path = join(entry, file).split(sep).join("/");
      if (!/\.(mjs|cjs|js)$/.test(path) || !shipped(path)) continue;
      for (const specifier of relativeSpecifiers(readFileSync(join(repoDir, path), "utf8"))) {
        const target = relative(repoDir, resolve(repoDir, dirname(path), specifier))
          .split(sep)
          .join("/");
        if (!shipped(target) || !existsSync(join(repoDir, target))) broken.push(`${path} → ${specifier}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});
