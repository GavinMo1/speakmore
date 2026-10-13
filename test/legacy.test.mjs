import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { startControlServer } from "../src/control.mjs";
import { openHistory } from "../src/history.mjs";
import { migrateLegacyData } from "../src/legacy.mjs";
import { resolvePaths } from "../src/paths.mjs";

let dir;
let legacyDir;
let paths;
let logged;
const log = {
  info: (event, fields) => logged.push({ event, ...fields }),
  warn: (event, fields) => logged.push({ event, ...fields }),
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-"));
  legacyDir = join(dir, "old");
  paths = resolvePaths({ SPEAKMORE_HOME: join(dir, "new") });
  logged = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 摆出 0.1 版用过之后的样子：一条历史和它的录音、设置、key，外加运行环境自己的缓存 */
function seedLegacy() {
  mkdirSync(join(legacyDir, "Recordings"), { recursive: true });
  mkdirSync(join(legacyDir, "GPUCache"));
  const audio = join(legacyDir, "Recordings", "a.webm");
  writeFileSync(audio, "录音");
  writeFileSync(join(legacyDir, "settings.json"), '{"hotkey":"fn"}\n');
  writeFileSync(join(legacyDir, "gemini-key.bin"), "密文");
  const history = openHistory(join(legacyDir, "history.db"));
  history.add({
    id: "a",
    status: "completed",
    refinedText: "以前说的话",
    error: null,
    duration: 3,
    audioLocalPath: audio,
    createdAt: "2026-10-12T01:00:00.000Z",
  });
  history.close();
}

const migrate = (overrides = {}) => migrateLegacyData({ paths, legacyDir, log, ...overrides });

test("没有旧目录：什么都不做", async () => {
  assert.deepEqual(await migrate(), []);
  assert.equal(existsSync(paths.home), false);
});

test("旧目录里的历史、录音、设置、key 搬进新的家目录；历史里记的录音位置跟着改；旧目录清掉", async () => {
  seedLegacy();
  assert.deepEqual(await migrate(), ["history.db", "Recordings", "settings.json", "gemini-key.bin"]);

  assert.equal(readFileSync(paths.settingsFile, "utf8"), '{"hotkey":"fn"}\n');
  assert.equal(readFileSync(paths.keyFile, "utf8"), "密文");
  const history = openHistory(paths.historyDb, { readOnly: true });
  const [row] = history.list();
  history.close();
  assert.equal(row.refinedText, "以前说的话");
  assert.equal(row.audioLocalPath, join(paths.recordingsDir, "a.webm"));
  assert.equal(readFileSync(row.audioLocalPath, "utf8"), "录音");

  // 剩下的只有运行环境的缓存，整个删掉，不留一个没人管的目录
  assert.equal(existsSync(legacyDir), false);
  assert.ok(logged.some((entry) => entry.event === "legacy_data_migrated"));
  // 再来一次什么都不做
  assert.deepEqual(await migrate(), []);
});

test("新目录里已经有的不覆盖：那一样留在旧目录里，旧目录也不删，并记一笔", async () => {
  seedLegacy();
  mkdirSync(paths.home, { recursive: true });
  writeFileSync(paths.settingsFile, '{"hotkey":"right_command"}\n');
  assert.deepEqual(await migrate(), ["history.db", "Recordings", "gemini-key.bin"]);
  assert.equal(readFileSync(paths.settingsFile, "utf8"), '{"hotkey":"right_command"}\n');
  assert.equal(existsSync(join(legacyDir, "settings.json")), true);
  assert.deepEqual(logged.find((entry) => entry.event === "legacy_data_kept")?.kept, ["settings.json"]);
});

test("旧版本的后台应用还在运行：先请它退出，退了再搬", async () => {
  seedLegacy();
  let app;
  app = await startControlServer({
    socketPath: join(legacyDir, "control.sock"),
    log: { warn() {} },
    handlers: { status: () => ({}), quit: () => void setTimeout(() => app.close(), 20) },
  });
  assert.equal((await migrate()).length, 4);
  assert.equal(existsSync(paths.historyDb), true);
});

test("旧版本的后台应用请不走：不搬（它还开着那个库），把话说清楚", async () => {
  seedLegacy();
  const app = await startControlServer({
    socketPath: join(legacyDir, "control.sock"),
    log: { warn() {} },
    handlers: { status: () => ({}), quit: () => {} },
  });
  try {
    await assert.rejects(migrate({ quitTimeoutMs: 100 }), /旧版本.*还在运行/);
    assert.equal(existsSync(paths.historyDb), false);
    assert.equal(existsSync(join(legacyDir, "history.db")), true);
  } finally {
    await app.close();
  }
});
