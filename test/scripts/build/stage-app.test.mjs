import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findCopyleft, pruneUnused, UNUSED_PACKAGES, unaccepted } from "../../../scripts/build/stage-app.mjs";

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

test("用不到的那几个解码器从发布包里删掉，留下 WebM 和 Ogg 要用的两个", (t) => {
  const dir = fakeModules(t, {
    "@audio/decode-webm": "MIT",
    "@audio/decode-opus": "MIT",
    "@audio/decode-aac": "GPL-2.0",
    "@audio/decode-eac3": "LGPL-2.1-or-later",
  });
  pruneUnused(dir);
  assert.ok(existsSync(join(dir, "node_modules", "@audio/decode-webm")));
  assert.ok(existsSync(join(dir, "node_modules", "@audio/decode-opus")));
  assert.ok(!existsSync(join(dir, "node_modules", "@audio/decode-aac")));
  assert.ok(!existsSync(join(dir, "node_modules", "@audio/decode-eac3")));
  assert.ok(!UNUSED_PACKAGES.includes("@audio/decode-webm") && !UNUSED_PACKAGES.includes("@audio/decode-opus"));
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

test("登记过的例外只按登记的那个许可证放行：codec-parser 是 LGPL 才放行，换成别的照样拦", () => {
  assert.deepEqual(unaccepted([{ name: "codec-parser", license: "LGPL-3.0-or-later" }]), []);
  assert.deepEqual(unaccepted([{ name: "codec-parser", license: "GPL-3.0" }]), [
    { name: "codec-parser", license: "GPL-3.0" },
  ]);
  assert.deepEqual(unaccepted([{ name: "@audio/decode-aac", license: "GPL-2.0" }]).length, 1);
});
