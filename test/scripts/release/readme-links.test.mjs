import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ARCHS, dmgName } from "../../../scripts/release/release-layout.mjs";

const repoDir = resolve(import.meta.dirname, "../../..");
/** 英文是主页，中文是切换过去的那一份：两份都写着安装包的下载链接 */
const READMES = ["README.md", "README.zh-CN.md"];

for (const name of READMES) {
  test(`${name} 里安装包的下载链接指向 package.json 的这个版本，两种芯片都有`, () => {
    const { version } = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8"));
    const readme = readFileSync(join(repoDir, name), "utf8");
    for (const arch of ARCHS) {
      const link = `https://dl.zephyrxiang.com/speakmore/v${version}/${dmgName(arch)}`;
      assert.ok(readme.includes(link), `${name} 里没有 ${link}：升了版本号要一起改下载链接`);
    }
  });
}

test("两份 README 顶上能互相切换", () => {
  const english = readFileSync(join(repoDir, "README.md"), "utf8");
  const chinese = readFileSync(join(repoDir, "README.zh-CN.md"), "utf8");
  assert.ok(english.includes('href="README.zh-CN.md"'), "README.md 顶上没有切到中文的链接");
  assert.ok(chinese.includes('href="README.md"'), "README.zh-CN.md 顶上没有切回英文的链接");
});

for (const name of READMES) {
  test(`${name} 里引用的截图都在仓库里`, () => {
    const readme = readFileSync(join(repoDir, name), "utf8");
    const images = [...readme.matchAll(/(?:src|srcset)="(docs\/images\/[^"]+)"/g)].map((match) => match[1]);
    assert.ok(images.length >= 3, `${name} 只找到 ${images.length} 张图`);
    for (const image of images) assert.ok(existsSync(join(repoDir, image)), `${name} 引用的 ${image} 不存在`);
  });
}
