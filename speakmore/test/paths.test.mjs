import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePaths } from "../src/paths.mjs";

test("默认都在家目录的 Application Support/SpeakMore 下", () => {
  const paths = resolvePaths({}, "/Users/someone");
  assert.equal(paths.dataDir, "/Users/someone/Library/Application Support/SpeakMore");
  assert.equal(paths.historyDb, "/Users/someone/Library/Application Support/SpeakMore/history.db");
  assert.equal(paths.recordingsDir, "/Users/someone/Library/Application Support/SpeakMore/Recordings");
  assert.equal(paths.settingsFile, "/Users/someone/Library/Application Support/SpeakMore/settings.json");
  assert.equal(paths.controlSocket, "/Users/someone/Library/Application Support/SpeakMore/control.sock");
  assert.equal(paths.logFile, "/Users/someone/Library/Application Support/SpeakMore/logs/main.log");
  assert.equal(paths.keyFile, "/Users/someone/Library/Application Support/SpeakMore/gemini-key.bin");
  assert.equal(paths.appKeyFile, "/Users/someone/Library/Application Support/SpeakMore/gemini-key.app.bin");
});

test("SPEAKMORE_HOME 把全部文件换到别处", () => {
  const paths = resolvePaths({ SPEAKMORE_HOME: "/tmp/elsewhere" }, "/Users/someone");
  for (const path of Object.values(paths)) assert.ok(path.startsWith("/tmp/elsewhere"), path);
});

test("SPEAKMORE_HOME 是空字符串时当作没设，不把文件写到当前目录", () => {
  assert.equal(
    resolvePaths({ SPEAKMORE_HOME: "" }, "/Users/someone").dataDir,
    "/Users/someone/Library/Application Support/SpeakMore",
  );
});

test("控制通道的路径太长时报错并说明怎么办，不等到监听时才失败", () => {
  const long = `/tmp/${"x".repeat(100)}`;
  assert.throws(() => resolvePaths({ SPEAKMORE_HOME: long }, "/Users/someone"), /SPEAKMORE_HOME/);
});
