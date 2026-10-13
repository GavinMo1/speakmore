import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createDaemon } from "../../src/cli/daemon.mjs";
import { startControlServer } from "../../src/control.mjs";
import { resolvePaths } from "../../src/paths.mjs";

const quietLog = { info() {}, warn() {}, error() {} };
const RUNNING = { pid: 4321, starting: false, permissions: { microphone: "granted" }, key: { state: "ready" } };

let dir;
let paths;
let app;
let spawned;
let progress;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-"));
  paths = resolvePaths({ SPEAKMORE_HOME: dir });
  app = null;
  spawned = [];
  progress = [];
});
afterEach(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 假的后台应用：一个真的控制通道，状态由测试给 */
async function startFakeApp(statusOf, extraHandlers = {}) {
  app = await startControlServer({
    socketPath: paths.controlSocket,
    log: quietLog,
    handlers: { status: () => statusOf(), ...extraHandlers },
  });
}

/** 假的"启动一个进程"：记下怎么启动的，再按测试的安排让应用出现或者退出 */
function fakeSpawn(behave) {
  return (command, args, options) => {
    const child = Object.assign(new EventEmitter(), { pid: 4321, unref() {} });
    spawned.push({ command, args, options });
    behave(child, options);
    return child;
  };
}

function daemonWith(overrides = {}) {
  return createDaemon({
    paths,
    packageDir: "/pkg",
    env: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" },
    resolveElectron: () => "/pkg/node_modules/electron/dist/Electron",
    ensureHelper: () => false,
    pollMs: 10,
    ...overrides,
  });
}

test("没有在运行时状态是 null", async () => {
  assert.equal(await daemonWith().status(), null);
});

test("启动：用 Electron 跑这个包，脱离终端，输出接到日志文件，等它答话了才算启动好", async () => {
  const spawn = fakeSpawn((_child, options) => {
    // 应用自己的输出应当落进日志文件
    writeFileSync(options.stdio[1], '{"event":"started"}\n');
    setTimeout(() => startFakeApp(() => RUNNING), 30);
  });
  const status = await daemonWith({ spawn }).start({ onProgress: (text) => progress.push(text) });

  assert.equal(status.pid, 4321);
  assert.equal(spawned.length, 1);
  const [{ command, args, options }] = spawned;
  assert.equal(command, "/pkg/node_modules/electron/dist/Electron");
  assert.deepEqual(args, ["/pkg"]);
  assert.equal(options.detached, true);
  assert.equal(options.stdio[0], "ignore");
  assert.equal(options.env.SPEAKMORE_CLI, "1");
  assert.equal(options.env.PATH, "/usr/bin");
  // 带着这个变量 Electron 会把自己当成普通的 Node，窗口和热键都不会有
  assert.equal("ELECTRON_RUN_AS_NODE" in options.env, false);
  assert.match(readFileSync(paths.logFile, "utf8"), /"started"/);
});

test("启动前先确保小帮手编好了；编了的话说一声", async () => {
  const order = [];
  const spawn = fakeSpawn(() => {
    order.push("spawn");
    startFakeApp(() => RUNNING);
  });
  const ensureHelper = (packageDir, { onBuild }) => {
    order.push(`helper:${packageDir}`);
    onBuild();
    return true;
  };
  await daemonWith({ spawn, ensureHelper }).start({ onProgress: (text) => progress.push(text) });
  assert.deepEqual(order, ["helper:/pkg", "spawn"]);
  assert.ok(progress.some((text) => /小程序/.test(text)));
});

test("应用还在等麦克风授权时说明在等什么，等它准备好再返回", async () => {
  let status = { ...RUNNING, starting: true, permissions: { microphone: "not-determined" } };
  const spawn = fakeSpawn(() => {
    startFakeApp(() => status);
    setTimeout(() => {
      status = RUNNING;
    }, 60);
  });
  const result = await daemonWith({ spawn }).start({ onProgress: (text) => progress.push(text) });
  assert.equal(result.starting, false);
  assert.equal(progress.filter((text) => /麦克风/.test(text)).length, 1);
});

test("应用一直没准备好时不无限等，把当时的状态交回去", async () => {
  const spawn = fakeSpawn(() => startFakeApp(() => ({ ...RUNNING, starting: true })));
  const result = await daemonWith({ spawn, readyTimeoutMs: 80 }).start({ onProgress() {} });
  assert.equal(result.starting, true);
});

test("应用刚启动就退出时报错，并带上日志最后几行", async () => {
  const spawn = fakeSpawn((child, options) => {
    writeFileSync(options.stdio[1], "第一行\n设置文件写错了：hotkey\n");
    setTimeout(() => child.emit("exit", 2, null), 20);
  });
  await assert.rejects(
    daemonWith({ spawn }).start({ onProgress() {} }),
    (error) => /没能启动/.test(error.message) && /设置文件写错了：hotkey/.test(error.message),
  );
});

test("应用一直不答话时按时放弃，并说去哪看日志", async () => {
  const spawn = fakeSpawn(() => {});
  await assert.rejects(daemonWith({ spawn, connectTimeoutMs: 60 }).start({ onProgress() {} }), /logs\/main\.log/);
});

test("停止：让它自己退出，等它真的不在了", async () => {
  await startFakeApp(() => RUNNING, { quit: () => void setTimeout(() => app.close(), 30) });
  assert.equal(await daemonWith().stop(), true);
  assert.equal(await daemonWith().status(), null);
});

test("本来就没有在运行时，停止什么都不做", async () => {
  assert.equal(await daemonWith().stop(), false);
});

test("说了退出却一直不退时，直接结束那个进程", async () => {
  const killed = [];
  await startFakeApp(() => RUNNING, { quit: () => {} });
  const kill = (pid, signal) => {
    killed.push([pid, signal]);
    app.close();
  };
  assert.equal(await daemonWith({ kill, quitTimeoutMs: 60 }).stop(), true);
  assert.deepEqual(killed, [[4321, "SIGTERM"]]);
});
