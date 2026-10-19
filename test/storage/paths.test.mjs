import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createTranslator } from "../../src/i18n/index.mjs";
import {
  ensureHome,
  installedHomeOf,
  keyFile,
  legacyDataDir,
  oldAppKeyFile,
  resolvePaths,
} from "../../src/storage/paths.mjs";
import { assertOwnerOnlyDir } from "../helpers/owner-only.mjs";

const zh = createTranslator("zh-CN");
/** 报错里给人看的那句，按中文翻出来对得上 */
const said = (pattern) => (error) => pattern.test(zh.text(error.problem ?? error.message));

test("所有东西都在家目录下的 .speakmore 这一个目录里", () => {
  const paths = resolvePaths({}, "/Users/someone", "darwin");
  assert.equal(paths.home, "/Users/someone/.speakmore");
  for (const [name, path] of Object.entries(paths)) {
    assert.ok(path === paths.home || path.startsWith("/Users/someone/.speakmore/"), `${name}: ${path}`);
  }
});

test("程序、你的东西、运行时产生的，各在各的位置", () => {
  const paths = resolvePaths({}, "/Users/someone", "darwin");
  const inHome = Object.fromEntries(
    Object.entries(paths).map(([name, path]) => [name, path.slice(paths.home.length + 1)]),
  );
  assert.deepEqual(inHome, {
    home: "",
    // 程序本身：安装时放进去，升级时整个换掉
    binDir: "bin",
    linksFile: "bin/links",
    appDir: "app",
    runtimeDir: "runtime",
    // Windows 上每个版本一个目录，current 记着现在用哪个
    versionsDir: "versions",
    currentFile: "current",
    // 你的东西
    settingsFile: "settings.json",
    vocabularyFile: "vocabulary.json",
    historyDb: "data/history.db",
    recordingsDir: "data/Recordings",
    // 用到时自动下载的本地模型
    modelsDir: "models",
    // 运行时产生的，删了会自己再建
    logFile: "logs/main.log",
    runDir: "run",
    controlSocket: "run/control.sock",
    pidFile: "run/daemon.pid",
    updateCheckFile: "run/update-check.json",
    updateFile: "run/update.json",
    updateLock: "run/update.lock",
    cacheDir: "cache",
  });
});

test("每家模型一把 key，App 和命令行共用一个文件；Gemini 的文件名和 0.3 以前一样；0.7.0 及以前 App 那一份另有名字", () => {
  const paths = resolvePaths({}, "/Users/someone", "darwin");
  assert.equal(keyFile(paths, "gemini"), "/Users/someone/.speakmore/gemini-key.bin");
  assert.equal(oldAppKeyFile(paths, "gemini"), "/Users/someone/.speakmore/gemini-key.app.bin");
  assert.equal(keyFile(paths, "openai"), "/Users/someone/.speakmore/openai-key.bin");
  // 润色那一跳的厂商也一样，自定义服务一把
  assert.equal(keyFile(paths, "deepseek"), "/Users/someone/.speakmore/deepseek-key.bin");
  assert.equal(keyFile(paths, "custom"), "/Users/someone/.speakmore/custom-key.bin");
  assert.throws(() => keyFile(paths, "../x"), /id/);
  assert.throws(() => oldAppKeyFile(paths, "../x"), /id/);
});

test("SPEAKMORE_HOME 把整个目录换到别处", () => {
  const paths = resolvePaths({ SPEAKMORE_HOME: "/tmp/elsewhere" }, "/Users/someone", "darwin");
  for (const path of Object.values(paths)) assert.ok(path.startsWith("/tmp/elsewhere"), path);
});

test("SPEAKMORE_HOME 是空字符串时当作没设，不把文件写到当前目录", () => {
  assert.equal(resolvePaths({ SPEAKMORE_HOME: "" }, "/Users/someone", "darwin").home, "/Users/someone/.speakmore");
});

test("控制通道的路径太长时报错并说明怎么办，不等到监听时才失败", () => {
  const long = `/tmp/${"x".repeat(100)}`;
  assert.throws(() => resolvePaths({ SPEAKMORE_HOME: long }, "/Users/someone", "darwin"), said(/SPEAKMORE_HOME/));
});

test("SPEAKMORE_HOME 要是绝对路径：相对路径会随着在哪个目录运行命令而变，找不到同一个后台应用", () => {
  for (const relative of ["data", "./data", "../data"]) {
    assert.throws(() => resolvePaths({ SPEAKMORE_HOME: relative }, "/Users/someone", "darwin"), said(/绝对路径/));
    assert.throws(() => resolvePaths({ SPEAKMORE_HOME: relative }, "C:\\Users\\someone", "win32"), said(/绝对路径/));
  }
});

test("ensureHome：把目录建出来，只有自己进得去（里面有录音和 key）", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = resolvePaths({ SPEAKMORE_HOME: join(dir, "home") });
  ensureHome(paths);
  assertOwnerOnlyDir(paths.home);
  assert.ok(statSync(join(paths.home, "run")).isDirectory());
  // 再来一次不出错，结果一样
  ensureHome(paths);
  assertOwnerOnlyDir(paths.home);
});

test("Windows 上同样是用户目录下的 .speakmore 一个目录；控制通道是按家目录取名的 named pipe，不在磁盘上", () => {
  const paths = resolvePaths({}, "C:\\Users\\someone", "win32");
  assert.equal(paths.home, "C:\\Users\\someone\\.speakmore");
  for (const [name, path] of Object.entries(paths)) {
    if (name === "controlSocket") continue;
    assert.ok(path === paths.home || path.startsWith("C:\\Users\\someone\\.speakmore\\"), `${name}: ${path}`);
  }
  assert.equal(paths.historyDb, "C:\\Users\\someone\\.speakmore\\data\\history.db");
  assert.match(paths.controlSocket, /^\\\\\.\\pipe\\speakmore-[0-9a-f]{16}$/);
  // 同一个家目录（大小写不同也是同一个）是同一个；换个家目录就是另一个
  assert.equal(resolvePaths({}, "c:\\users\\SOMEONE", "win32").controlSocket, paths.controlSocket);
  assert.notEqual(
    resolvePaths({ SPEAKMORE_HOME: "D:\\speakmore" }, "C:\\Users\\someone", "win32").controlSocket,
    paths.controlSocket,
  );
  // 套接字路径的长度上限是 macOS 的事，pipe 的名字和家目录多长无关
  assert.doesNotThrow(() => resolvePaths({ SPEAKMORE_HOME: `D:\\${"x".repeat(100)}` }, "C:\\Users\\someone", "win32"));
});

test("0.1 版放数据的地方：家目录的 Application Support/SpeakMore；0.1 只有 macOS 版，别的系统上没有", () => {
  assert.equal(legacyDataDir("/Users/someone", "darwin"), "/Users/someone/Library/Application Support/SpeakMore");
  assert.equal(legacyDataDir("C:\\Users\\someone", "win32"), null);
});

test("Windows 上装好的那一份：从程序的位置（<家目录>\\versions\\<版本>\\runtime\\electron.exe、旁边有 app）找回家目录；别的摆法是 null", () => {
  // Windows 的路径不分大小写
  const exists = (path) => path.toLowerCase() === "d:\\speakmore\\versions\\0.9.3-1a2b3c4d\\app\\package.json";
  assert.equal(
    installedHomeOf("D:\\SpeakMore\\versions\\0.9.3-1a2b3c4d\\runtime\\electron.exe", exists),
    "D:\\SpeakMore",
  );
  assert.equal(
    installedHomeOf("D:\\SpeakMore\\Versions\\0.9.3-1a2b3c4d\\Runtime\\Electron.EXE", exists),
    "D:\\SpeakMore",
  );
  // 0.9.2 及以前的摆法（家目录里直接是 runtime、app）：新版本的程序不会从那里跑
  assert.equal(
    installedHomeOf("D:\\SpeakMore\\runtime\\electron.exe", () => true),
    null,
  );
  // 从源码跑的：node_modules 里的 electron.exe
  assert.equal(installedHomeOf("C:\\dev\\speakmore\\node_modules\\electron\\dist\\electron.exe", exists), null);
  // 旁边没有 app
  assert.equal(installedHomeOf("E:\\other\\versions\\0.9.3-1a2b3c4d\\runtime\\electron.exe", exists), null);
  assert.equal(installedHomeOf("/Users/someone/.speakmore/runtime/Electron.app/Contents/MacOS/Electron", exists), null);
});
