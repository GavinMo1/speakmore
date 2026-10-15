import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { openHistory } from "../../src/storage/history.mjs";
import { resolvePaths } from "../../src/storage/paths.mjs";

const BIN = resolve(import.meta.dirname, "..", "..", "bin", "speakmore.mjs");

test("输出接到 head 这类只读开头就关掉的程序上：安静地结束，不甩一屏报错", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // 历史要多到一次写不完：管道那头关掉时这边还在写
  const history = openHistory(resolvePaths({ SPEAKMORE_HOME: dir }).historyDb);
  for (let index = 0; index < 400; index++) {
    history.add({
      id: `id-${index}`,
      status: "completed",
      refinedText: "一句不短的话。".repeat(60),
      error: null,
      duration: 3,
      audioLocalPath: null,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    });
  }
  history.close();

  const result = spawnSync(
    "/bin/bash",
    ["-c", 'set -o pipefail; "$0" "$1" history -n 400 --json | head -c 10 >/dev/null', process.execPath, BIN],
    { encoding: "utf8", env: { ...process.env, SPEAKMORE_HOME: dir } },
  );
  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
});

test("说什么语言：设置里写了就用它；跟随系统时看终端的 LC_ALL、LC_MESSAGES、LANG；认不出来是英文", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { LC_ALL: _all, LC_MESSAGES: _messages, LANG: _lang, ...base } = process.env;
  const helpIn = (env) =>
    spawnSync(process.execPath, [BIN, "help"], {
      encoding: "utf8",
      env: { ...base, SPEAKMORE_HOME: dir, ...env },
    }).stdout.split("\n")[0];

  assert.equal(helpIn({ LANG: "zh_CN.UTF-8" }), "SpeakMore：按一下热键说话，整理好的文字贴进当前输入框。");
  assert.match(helpIn({ LANG: "en_US.UTF-8" }), /^SpeakMore: press a hotkey/);
  assert.match(helpIn({ LANG: "zh_CN.UTF-8", LC_ALL: "en_GB.UTF-8" }), /^SpeakMore: press a hotkey/);
  // 繁体、日文、C：我们没有，用英文
  for (const LANG of ["zh_TW.UTF-8", "ja_JP.UTF-8", "C"]) assert.match(helpIn({ LANG }), /^SpeakMore: press/, LANG);
  assert.match(helpIn({}), /^SpeakMore: press/);

  // 设置里定了的话盖过终端的语言；环境变量 SPEAKMORE_LANGUAGE 又盖过设置
  writeFileSync(resolvePaths({ SPEAKMORE_HOME: dir }).settingsFile, JSON.stringify({ language: "zh-CN" }));
  assert.match(helpIn({ LANG: "en_US.UTF-8" }), /^SpeakMore：/);
  assert.match(helpIn({ LANG: "zh_CN.UTF-8", SPEAKMORE_LANGUAGE: "en" }), /^SpeakMore: press/);
  // 设置文件坏了：先按终端的语言说，坏在哪由读设置的命令报
  writeFileSync(resolvePaths({ SPEAKMORE_HOME: dir }).settingsFile, "{ 坏了");
  assert.match(helpIn({ LANG: "zh_CN.UTF-8" }), /^SpeakMore：/);
});

test("Node 太旧：按终端的语言说要哪个版本；旧到连文案那一层都加载不了时用英文说，不甩调用栈", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  /** 装成某个版本的 Node；ancient 时再拿掉 16.9 以前没有的写法 */
  const runAs = (version, { ancient = false, LANG = "zh_CN.UTF-8" } = {}) => {
    const preload = join(dir, `${version}.mjs`);
    writeFileSync(
      preload,
      `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });\n` +
        (ancient ? "delete String.prototype.replaceAll;\ndelete Object.hasOwn;\n" : ""),
    );
    const { LC_ALL: _all, LC_MESSAGES: _messages, ...base } = process.env;
    return spawnSync(process.execPath, ["--import", preload, BIN, "help"], {
      encoding: "utf8",
      env: { ...base, SPEAKMORE_HOME: dir, LANG },
    });
  };

  const zhTerminal = runAs("20.18.1");
  assert.equal(zhTerminal.status, 1);
  assert.equal(zhTerminal.stderr, "SpeakMore 需要 Node 22.13 或更新的版本（23 系列要 23.4 以上），现在是 20.18.1。\n");

  const ancient = runAs("14.21.3", { ancient: true });
  assert.equal(ancient.status, 1);
  assert.equal(
    ancient.stderr,
    "SpeakMore needs Node 22.13 or newer (23.4 or newer on the 23 line); this is 14.21.3.\n",
  );
});
