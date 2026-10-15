import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ARCHS, dmgName } from "../../../scripts/release/release-layout.mjs";

const repoDir = resolve(import.meta.dirname, "../../..");

test("README 里安装包的下载链接指向 package.json 的这个版本，两种芯片都有", () => {
  const { version } = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8"));
  const readme = readFileSync(join(repoDir, "README.md"), "utf8");
  for (const arch of ARCHS) {
    const link = `https://dl.zephyrxiang.com/speakmore/v${version}/${dmgName(arch)}`;
    assert.ok(readme.includes(link), `README 里没有 ${link}：升了版本号要一起改下载链接`);
  }
});
