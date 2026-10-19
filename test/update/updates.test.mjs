import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { TimeoutError } from "../../src/control.mjs";
import { createTranslator, LocalizedError, msg } from "../../src/i18n/index.mjs";
import { resolvePaths } from "../../src/storage/paths.mjs";
import { createUpdates } from "../../src/update/index.mjs";
import { acquireLock, readProgress } from "../../src/update/state.mjs";

// 内核里的版本检查和更新（src/update/index.mjs）：下载地址、App、安装脚本、正在运行的那个都换成假的，
// 记下按什么顺序做了什么。命令行那边的说法另在 test/cli/main.test.mjs 里测（它也走这里，用的是同一套假的）。

const zh = createTranslator("zh-CN");
const NOW = new Date("2026-10-19T08:00:00.000Z");
const DEAD_PID = 2 ** 22 + 12345;

let dir;
let paths;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-updates-"));
  paths = resolvePaths({ SPEAKMORE_HOME: dir });
  // 像是用安装脚本装的：程序在家目录的 app 里
  mkdirSync(paths.appDir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * 一套假的：steps 按先后记下做了什么，phases 记下每一步时 update.json 里写的阶段。
 * running：正在运行的那个（null 没在运行、"hung" 卡住了）；app：装着的 App（null 没装）
 */
function setup({
  latest = "v0.2.0",
  running = null,
  app = null,
  home = { version: "0.1.0" },
  stageApp = () => {},
  commitApp = () => {},
  stageHome = () => {},
  installCode = 0,
  openApp = () => {},
  startCode = 0,
  packageDir = paths.appDir,
  now = () => NOW,
} = {}) {
  const steps = [];
  const phases = [];
  const phase = () => phases.push(readProgress(paths)?.phase ?? null);
  let current = running;
  const instance = {
    async status() {
      if (current === "hung") throw new TimeoutError("status", 5_000);
      return current;
    },
    async stop() {
      steps.push("stop");
      phase();
      current = null;
      return "quit";
    },
  };
  const updates = createUpdates({
    paths,
    env: {},
    packageDir,
    version: "0.1.0",
    instance,
    platform: "darwin",
    now,
    pid: 999_999,
    release: {
      async latest() {
        steps.push("latest");
        if (latest instanceof Error) throw latest;
        return latest;
      },
    },
    bundles: {
      async find({ pid }) {
        steps.push(`find-app:${pid}`);
        return app;
      },
      async stage(version, path) {
        steps.push(`stage-app:${version}`);
        phase();
        stageApp();
        return {
          commit() {
            steps.push("commit-app");
            commitApp();
          },
          discard() {
            steps.push("discard-app");
          },
        };
      },
      async open(path) {
        steps.push(`open-app:${path}`);
        openApp();
      },
    },
    homes: {
      find: () => home,
      async stage(version) {
        steps.push(`stage-home:${version}`);
        stageHome();
        return {
          dir: "staged",
          discard() {
            steps.push("discard-home");
          },
        };
      },
      async install(_staged, version) {
        steps.push(`install-home:${version}`);
        phase();
        return installCode;
      },
      async start() {
        steps.push("start-home");
        return startCode;
      },
    },
  });
  return { updates, steps, phases };
}

const APP = { path: "/Applications/SpeakMore.app", version: "0.1.0" };
const APP_RUNNING = { pid: 4242, packaged: true };
const HOME_RUNNING = { pid: 4343, packaged: false };

test("检查：一天最多问一次下载地址，结果记在家目录里两边共用；点了检查（force）就再问", async () => {
  const { updates, steps } = setup();
  const first = await updates.check();
  assert.equal(first.latest, "0.2.0");
  assert.equal(first.available, true);
  assert.deepEqual(first.behind, [{ kind: "home", version: "0.1.0" }]);
  assert.equal(first.checkedAt, NOW.toISOString());
  assert.deepEqual(JSON.parse(readFileSync(paths.updateCheckFile, "utf8")), {
    checkedAt: NOW.toISOString(),
    latest: "0.2.0",
  });
  await updates.check();
  assert.equal(steps.filter((step) => step === "latest").length, 1, "一天之内不再问");
  await updates.check({ force: true });
  assert.equal(steps.filter((step) => step === "latest").length, 2);

  // 过了一天：顺带的检查也再问
  const later = setup({ now: () => new Date(NOW.getTime() + 24 * 60 * 60 * 1000) });
  await later.updates.check();
  assert.deepEqual(
    later.steps.filter((step) => step === "latest"),
    ["latest"],
  );
});

test("检查：问不到不抛，说原因；之前知道的最新版本留着（不因为这次没网就当没有新版本）", async () => {
  await setup().updates.check();
  const offline = setup({
    latest: new LocalizedError(msg("update.unreachable", { url: "https://x/latest", reason: "curl: (6)" })),
  });
  const result = await offline.updates.check({ force: true });
  assert.match(zh.text(result.problem), /无法连接 https:\/\/x\/latest：curl: \(6\)/);
  assert.equal(result.latest, "0.2.0");
  assert.equal(result.available, true);
  assert.equal(JSON.parse(readFileSync(paths.updateCheckFile, "utf8")).latest, "0.2.0");

  // 问到的不像版本号：同样当没问到
  const garbled = setup({ latest: "<html>" });
  const bad = await garbled.updates.check({ force: true });
  assert.match(zh.text(bad.problem), /版本号无效/);
});

test("检查：两份都看，App 旧了也算有更新；正在跑的 App 按进程号找", async () => {
  const { updates, steps } = setup({ latest: "v0.1.0", app: { ...APP, version: "0.0.9" } });
  const result = await updates.check({ runningApp: 4242 });
  assert.deepEqual(result.behind, [{ kind: "bundle", version: "0.0.9", path: APP.path }]);
  assert.ok(steps.includes("find-app:4242"));
});

test("检查：从源码跑的不问下载地址，说是从源码跑的", async () => {
  const outside = mkdtempSync(join(tmpdir(), "sm-src-"));
  try {
    const { updates, steps } = setup({ packageDir: outside });
    assert.equal(updates.self, null);
    const result = await updates.check({ force: true });
    assert.equal(result.fromSource, true);
    assert.equal(result.available, false);
    assert.deepEqual(steps, []);
    await assert.rejects(updates.run({ by: "app" }), (error) => /git pull/.test(zh.text(error.problem)));
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("更新：先把两份都下好（这时 App 还在跑），再停、换、重新打开；每一步写进 update.json", async () => {
  const { updates, steps, phases } = setup({ running: APP_RUNNING, app: APP });
  const result = await updates.run({ by: "app" });
  assert.deepEqual(result, { updated: true, latest: "0.2.0", restarted: "bundle", running: true });
  assert.deepEqual(steps, [
    "latest",
    "find-app:4242",
    "stage-app:0.2.0",
    "stage-home:0.2.0",
    "stop",
    "commit-app",
    "install-home:0.2.0",
    `open-app:${APP.path}`,
    "discard-home",
  ]);
  assert.deepEqual(phases, ["downloading", "installing", "installing"]);
  const record = readProgress(paths);
  assert.equal(record.state, "done");
  assert.equal(record.by, "app");
  assert.equal(record.version, "0.2.0");
  assert.deepEqual(record.from, { home: "0.1.0", bundle: "0.1.0" });
  assert.equal(existsSync(paths.updateLock), false, "锁放掉了");
});

test("更新：已经是最新的什么都不做，记成 current（App 不会当成刚更新过）", async () => {
  const { updates, steps } = setup({ latest: "v0.1.0", running: HOME_RUNNING });
  assert.deepEqual(await updates.run({ by: "cli" }), {
    updated: false,
    latest: "0.1.0",
    restarted: null,
    running: true,
  });
  assert.ok(!steps.includes("stop"));
  assert.equal(readProgress(paths).state, "current");
});

test("更新：下载、核对失败：什么都不停，记下原因，下好的删掉，锁放掉", async () => {
  const broken = new LocalizedError(msg("update.checksum", { file: "speakmore-darwin-arm64.tar.gz" }));
  const { updates, steps } = setup({
    running: APP_RUNNING,
    app: APP,
    stageHome: () => {
      throw broken;
    },
  });
  await assert.rejects(updates.run({ by: "app" }), (error) => error === broken);
  assert.ok(!steps.includes("stop"));
  assert.ok(steps.includes("discard-app"), "已经下好的 App 删掉");
  const record = readProgress(paths);
  assert.equal(record.state, "failed");
  assert.match(zh.text(record.problem), /speakmore-darwin-arm64\.tar\.gz 与发布的校验值不符/);
  assert.equal(existsSync(paths.updateLock), false);
});

test("更新：安装脚本没装成：原来在跑的照样重新打开，记下没装成", async () => {
  const { updates, steps } = setup({ running: HOME_RUNNING, installCode: 2 });
  await assert.rejects(updates.run({ by: "cli" }), (error) => /退出码 2/.test(zh.text(error.problem)));
  assert.deepEqual(steps.slice(-3), ["install-home:0.2.0", "start-home", "discard-home"]);
  assert.equal(readProgress(paths).state, "failed");
});

test("更新：换上了但没重新打开：照实说，记成没完成", async () => {
  const reopen = setup({
    running: APP_RUNNING,
    app: APP,
    home: null,
    openApp: () => {
      throw Object.assign(new Error("open failed"), { said: "LSOpenURLsWithRole() failed" });
    },
  });
  await assert.rejects(reopen.updates.run({ by: "app" }), (error) =>
    /已换上新版本，但未能重新打开 SpeakMore\.app（LSOpenURLsWithRole\(\) failed）/.test(zh.text(error.problem)),
  );
  assert.equal(readProgress(paths).state, "failed");

  const restart = setup({ running: HOME_RUNNING, startCode: 1 });
  await assert.rejects(restart.updates.run({ by: "cli" }), (error) =>
    /未能重新启动（退出码 1）/.test(zh.text(error.problem)),
  );
});

test("更新：只换 App、在跑的是家目录那一份：不停它；卡住的不知道是哪一份：停掉，换完不打开", async () => {
  const other = setup({ latest: "v0.1.0", running: HOME_RUNNING, app: { ...APP, version: "0.0.9" } });
  assert.deepEqual(await other.updates.run({ by: "cli" }), {
    updated: true,
    latest: "0.1.0",
    restarted: null,
    running: true,
  });
  assert.ok(!other.steps.includes("stop"));

  const hung = setup({ running: "hung", app: APP });
  assert.deepEqual(await hung.updates.run({ by: "cli" }), {
    updated: true,
    latest: "0.2.0",
    restarted: null,
    running: false,
  });
  assert.ok(hung.steps.includes("stop"));
  assert.ok(hung.steps.includes("find-app:null"));
  assert.ok(!hung.steps.some((step) => step.startsWith("open-app") || step === "start-home"));
});

test("锁：两边不能同时更新；拿着锁的进程已经不在了的当没人拿着；只放自己的", () => {
  mkdirSync(paths.runDir, { recursive: true });
  const release = acquireLock(paths, { pid: 111, alive: () => true });
  assert.throws(
    () => acquireLock(paths, { pid: 222, alive: () => true }),
    (error) => /另一个更新正在进行（进程 111）/.test(zh.text(error.problem)),
  );
  // 拿着锁的不在了
  assert.doesNotThrow(() => acquireLock(paths, { pid: 222, alive: (pid) => pid !== 111 }));
  // 111 再放锁：已经不是它的了，不动
  release();
  assert.equal(readFileSync(paths.updateLock, "utf8"), "222");
  // 刚建好、还没写进进程号的：算有人拿着
  writeFileSync(paths.updateLock, "");
  assert.throws(
    () => acquireLock(paths, { pid: 333 }),
    (error) => /另一个更新正在进行（进程 \?）/.test(zh.text(error.problem)),
  );
});

test("进行到哪：标着正在更新、可那个进程不在了（或者过了两小时）的算中断，说去看日志", () => {
  const { updates } = setup();
  mkdirSync(paths.runDir, { recursive: true });
  const running = { state: "running", phase: "installing", version: "0.2.0", by: "app", startedAt: NOW.toISOString() };
  writeFileSync(paths.updateFile, JSON.stringify({ ...running, pid: process.pid }));
  assert.equal(updates.progress().state, "running");
  writeFileSync(paths.updateFile, JSON.stringify({ ...running, pid: DEAD_PID }));
  const interrupted = updates.progress();
  assert.equal(interrupted.state, "failed");
  assert.match(zh.text(interrupted.problem), /上一次更新未完成就中断了，经过见日志 .*main\.log/);
  writeFileSync(
    paths.updateFile,
    JSON.stringify({
      ...running,
      pid: process.pid,
      startedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    }),
  );
  assert.equal(updates.progress().state, "failed");
});

test("更新好了告诉过用户之后记一笔，下次启动不再说；写到一半的记录当没有", () => {
  const { updates } = setup();
  mkdirSync(paths.runDir, { recursive: true });
  writeFileSync(paths.updateFile, JSON.stringify({ state: "done", version: "0.2.0", by: "app", pid: 1 }));
  updates.markShown();
  assert.equal(readProgress(paths).shown, true);
  writeFileSync(paths.updateFile, '{"state": "do');
  assert.equal(updates.progress(), null);
});
