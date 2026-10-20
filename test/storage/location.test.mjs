import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createTranslator } from "../../src/i18n/index.mjs";
import {
  forgetLocation,
  locationFileOf,
  readLocation,
  readLocationRecord,
  removeLocation,
  writeLocation,
} from "../../src/storage/location.mjs";

const zh = createTranslator("zh-CN");
const said = (pattern) => (error) => pattern.test(zh.text(error.problem ?? error.message));

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "sm-location-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const MAC_FILE = "/Users/someone/Library/Application Support/com.zephyrxiang.speakmore/location.json";

test("定位文件的位置是固定的：macOS 在按应用标识取名的 Application Support 下，Windows 在本机的 AppData\\Local\\SpeakMore 下", () => {
  assert.equal(locationFileOf({}, "/Users/someone", "darwin"), MAC_FILE);
  // 不认 XDG_CONFIG_HOME 这类环境变量：从程序坞打开的 App 拿不到终端里设的，认它的话两边会看不同的文件
  assert.equal(locationFileOf({ XDG_CONFIG_HOME: "/elsewhere" }, "/Users/someone", "darwin"), MAC_FILE);
  assert.equal(
    locationFileOf({ LOCALAPPDATA: "C:\\Users\\someone\\AppData\\Local" }, "C:\\Users\\someone", "win32"),
    "C:\\Users\\someone\\AppData\\Local\\SpeakMore\\location.json",
  );
  // 没有 LOCALAPPDATA（极少见）时按它默认的位置
  assert.equal(
    locationFileOf({}, "C:\\Users\\someone", "win32"),
    "C:\\Users\\someone\\AppData\\Local\\SpeakMore\\location.json",
  );
});

test("没有定位文件是 null：老版本装的、还没装过的，都用默认位置", (t) => {
  const dir = tempDir(t);
  assert.equal(readLocation(join(dir, "location.json"), process.platform), null);
});

test("写进去的读得回来：建好上一级目录，路径里有空格、中文、引号也行", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "config", "speakmore", "location.json");
  const home = process.platform === "win32" ? 'D:\\我的 "盘"\\.speakmore' : '/Volumes/我的 "盘"/.speakmore';
  writeLocation(file, home);
  assert.equal(readLocation(file, process.platform), home);
  // 是一份给人也看得懂的 JSON，以后要加别的项往里加
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { home });
});

test("读回来的家目录规范成完整写法：末尾的分隔符、. 和 .. 去掉，和安装脚本算出来的是同一个字符串", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "location.json");
  writeFileSync(file, JSON.stringify({ home: "/Volumes/Data/a/../.speakmore/" }));
  assert.equal(readLocation(file, "darwin"), "/Volumes/Data/.speakmore");
  writeFileSync(file, JSON.stringify({ home: "D:\\a\\..\\.speakmore\\" }));
  assert.equal(readLocation(file, "win32"), "D:\\.speakmore");
});

test("定位文件坏了就明确报错，不悄悄退回默认位置（那样会在默认位置新建一个空的，看起来像数据丢了）", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "location.json");
  for (const text of [
    "{ 坏了",
    "[]",
    "null",
    '{"home": 1}',
    '{"home": ""}',
    '{"home": "relative/path"}',
    '{"other": "/x"}',
  ]) {
    writeFileSync(file, text);
    assert.throws(() => readLocation(file, "darwin"), said(/location\.json/), text);
  }
  // 换行这类控制字符不会出现在正经的路径里
  writeFileSync(file, JSON.stringify({ home: "/tmp/a\nb" }));
  assert.throws(() => readLocation(file, "darwin"), said(/location\.json/));
  // Windows 的路径要带盘符或者 \\：/x 在那里不是绝对路径
  writeFileSync(file, JSON.stringify({ home: "/x" }));
  assert.throws(() => readLocation(file, "win32"), said(/location\.json/));
});

test("读不了（是个目录、没权限）也照实报，不当作没有", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "location.json");
  mkdirSync(file);
  assert.throws(() => readLocation(file, process.platform), said(/location\.json/));
});

test("写的时候不留半截：先写到旁边再改名换上", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "location.json");
  writeLocation(file, process.platform === "win32" ? "D:\\a\\.speakmore" : "/a/.speakmore");
  writeLocation(file, process.platform === "win32" ? "E:\\b\\.speakmore" : "/b/.speakmore");
  assert.deepEqual(readFileSync(file, "utf8").length > 0 && JSON.parse(readFileSync(file, "utf8")), {
    home: process.platform === "win32" ? "E:\\b\\.speakmore" : "/b/.speakmore",
  });
});

test("forgetLocation：只删指着这个家目录的那份（Windows 上不分大小写），指着别处的不动", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "location.json");
  writeLocation(file, "/a/.speakmore");
  assert.equal(forgetLocation(file, "/b/.speakmore", "darwin"), false);
  assert.equal(readLocation(file, "darwin"), "/a/.speakmore");
  assert.equal(forgetLocation(file, "/a/.speakmore/", "darwin"), true);
  assert.equal(readLocation(file, "darwin"), null);
  // 本来就没有
  assert.equal(forgetLocation(file, "/a/.speakmore", "darwin"), false);

  writeLocation(file, "D:\\SpeakMore\\.speakmore");
  assert.equal(forgetLocation(file, "d:\\speakmore\\.SPEAKMORE", "win32"), true);
  assert.equal(readLocation(file, "win32"), null);
});

test("正在搬家时多一项 moving：读家目录的人只认 home；moving 坏了当没有，不挡住启动", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "location.json");
  writeLocation(file, {
    home: "/a/.speakmore",
    moving: { to: "/b/.speakmore/", startedAt: "2026-10-20T00:00:00.000Z" },
  });
  assert.equal(readLocation(file, "darwin"), "/a/.speakmore");
  assert.deepEqual(readLocationRecord(file, "darwin"), {
    home: "/a/.speakmore",
    moving: { to: "/b/.speakmore", startedAt: "2026-10-20T00:00:00.000Z" },
  });
  writeFileSync(file, JSON.stringify({ home: "/a/.speakmore", moving: { to: "relative" } }));
  assert.deepEqual(readLocationRecord(file, "darwin"), { home: "/a/.speakmore", moving: null });
});

test("带 BOM 的也认（PowerShell 5.1 写 UTF-8 常带）；removeLocation 本来没有也不报错", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "location.json");
  writeFileSync(file, `\uFEFF${JSON.stringify({ home: "D:\\SM\\.speakmore" })}`);
  assert.equal(readLocation(file, "win32"), "D:\\SM\\.speakmore");
  removeLocation(file);
  removeLocation(file);
  assert.equal(readLocation(file, "win32"), null);
});

test("removeLocation：所在的目录空了一起删，不空就留着", (t) => {
  const dir = join(tempDir(t), "com.zephyrxiang.speakmore");
  const file = join(dir, "location.json");
  writeLocation(file, { home: "/a/.speakmore" });
  removeLocation(file);
  assert.equal(existsSync(dir), false);
  writeLocation(file, { home: "/a/.speakmore" });
  writeFileSync(join(dir, "other"), "x");
  removeLocation(file);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(join(dir, "other")), true);
});

test("forgetLocation：定位文件坏了时不删（不知道它指着哪）", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "location.json");
  writeFileSync(file, "{ 坏了");
  assert.throws(() => forgetLocation(file, "/a/.speakmore", "darwin"), said(/location\.json/));
  assert.equal(readFileSync(file, "utf8"), "{ 坏了");
});
