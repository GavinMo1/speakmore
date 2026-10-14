import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureHome, keyFile, legacyDataDir, resolvePaths } from "../../src/storage/paths.mjs";

test("所有东西都在家目录下的 .speakmore 这一个目录里", () => {
  const paths = resolvePaths({}, "/Users/someone");
  assert.equal(paths.home, "/Users/someone/.speakmore");
  for (const [name, path] of Object.entries(paths)) {
    assert.ok(path === paths.home || path.startsWith("/Users/someone/.speakmore/"), `${name}: ${path}`);
  }
});

test("程序、你的东西、运行时产生的，各在各的位置", () => {
  const paths = resolvePaths({}, "/Users/someone");
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
    // 你的东西
    settingsFile: "settings.json",
    historyDb: "data/history.db",
    recordingsDir: "data/Recordings",
    // 运行时产生的，删了会自己再建
    logFile: "logs/main.log",
    controlSocket: "run/control.sock",
    pidFile: "run/daemon.pid",
    cacheDir: "cache",
  });
});

test("每家模型一把 key，命令启动的和打成应用的各存各的；Gemini 的文件名和 0.3 以前一样，不用迁移", () => {
  const paths = resolvePaths({}, "/Users/someone");
  assert.equal(keyFile(paths, "gemini"), "/Users/someone/.speakmore/gemini-key.bin");
  assert.equal(keyFile(paths, "gemini", { packaged: true }), "/Users/someone/.speakmore/gemini-key.app.bin");
  assert.equal(keyFile(paths, "openai"), "/Users/someone/.speakmore/openai-key.bin");
  assert.throws(() => keyFile(paths, "../x"), /id/);
});

test("SPEAKMORE_HOME 把整个目录换到别处", () => {
  const paths = resolvePaths({ SPEAKMORE_HOME: "/tmp/elsewhere" }, "/Users/someone");
  for (const path of Object.values(paths)) assert.ok(path.startsWith("/tmp/elsewhere"), path);
});

test("SPEAKMORE_HOME 是空字符串时当作没设，不把文件写到当前目录", () => {
  assert.equal(resolvePaths({ SPEAKMORE_HOME: "" }, "/Users/someone").home, "/Users/someone/.speakmore");
});

test("控制通道的路径太长时报错并说明怎么办，不等到监听时才失败", () => {
  const long = `/tmp/${"x".repeat(100)}`;
  assert.throws(() => resolvePaths({ SPEAKMORE_HOME: long }, "/Users/someone"), /SPEAKMORE_HOME/);
});

test("SPEAKMORE_HOME 要是绝对路径：相对路径会随着在哪个目录运行命令而变，找不到同一个后台应用", () => {
  for (const relative of ["data", "./data", "../data"]) {
    assert.throws(() => resolvePaths({ SPEAKMORE_HOME: relative }, "/Users/someone"), /绝对路径/);
  }
});

test("ensureHome：把目录建出来，只有自己进得去（里面有录音和 key）", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = resolvePaths({ SPEAKMORE_HOME: join(dir, "home") });
  ensureHome(paths);
  assert.equal(statSync(paths.home).mode & 0o777, 0o700);
  assert.ok(statSync(join(paths.home, "run")).isDirectory());
  // 再来一次不出错；别人把权限放宽过的话收回来
  ensureHome(paths);
});

test("0.1 版放数据的地方：家目录的 Application Support/SpeakMore", () => {
  assert.equal(legacyDataDir("/Users/someone"), "/Users/someone/Library/Application Support/SpeakMore");
});
