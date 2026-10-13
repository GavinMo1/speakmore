import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Cancelled } from "../../src/cli/ask-secret.mjs";
import { run } from "../../src/cli/main.mjs";
import { NotRunningError, TimeoutError } from "../../src/control.mjs";
import { openHistory } from "../../src/history.mjs";
import { resolvePaths } from "../../src/paths.mjs";

const READY = {
  pid: 4321,
  version: "0.1.0",
  starting: false,
  hotkey: "right_option",
  hotkeyLabel: "右 Option 键",
  model: "gemini-3.5-flash",
  thinking: "MINIMAL",
  packaged: false,
  helper: "running",
  key: { state: "ready", source: "stored", problem: null, verified: true },
  permissions: { microphone: "granted", listen: true, trusted: true },
  summary: { ready: true, missing: [], blocker: null, degraded: null },
};
/** 存着的那把被撤销了 */
const REVOKED_KEY = {
  ...READY,
  key: { state: "rejected", source: "stored", cause: "key", problem: "这把 key 无效，检查有没有复制完整" },
  summary: { ready: false, missing: ["Gemini API key"], blocker: "API key 不能用", degraded: null },
};
/** 模型名写错：Gemini 拒绝了请求，key 本身没问题 */
const WRONG_MODEL = {
  ...READY,
  model: "gemini-nope",
  key: {
    state: "rejected",
    source: "stored",
    cause: "other",
    problem: "Gemini 拒绝了请求：models/gemini-nope is not found",
  },
  summary: { ready: false, missing: ["Gemini 验证"], blocker: "Gemini 验证没通过", degraded: null },
};
const NO_KEY = {
  ...READY,
  key: { state: "missing", source: null, problem: null },
  summary: { ready: false, missing: ["Gemini API key"], blocker: "还没有填 Gemini API key", degraded: null },
};
const NO_PERMISSIONS = {
  ...READY,
  permissions: { microphone: "denied", listen: false, trusted: true },
  summary: { ready: false, missing: ["麦克风权限", "输入监控权限"], blocker: "没有麦克风权限", degraded: null },
};

let dir;
let paths;
/** 有的测试要在家目录以外放东西 */
let outside = null;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-"));
  paths = resolvePaths({ SPEAKMORE_HOME: dir });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (outside) rmSync(outside, { recursive: true, force: true });
  outside = null;
});

/**
 * 假的后台应用。running 是它现在的状态（null 表示没在运行），afterStart 是启动之后的状态，
 * saveKey 决定存 key 的结果，stopped 是停止时的说法，hung 为 true 表示它卡住了不答话。
 * calls 记下命令行对它做过什么。
 */
function fakeDaemon({
  running = null,
  afterStart = READY,
  saveKey = () => ({ ok: true }),
  stopped = "quit",
  hung = false,
} = {}) {
  const daemon = {
    calls: [],
    current: running,
    hung,
    async status(params = {}) {
      if (daemon.hung) throw new TimeoutError("status", 5_000);
      if (params.recheck) daemon.calls.push("recheck");
      return daemon.current;
    },
    async start({ onProgress }) {
      daemon.calls.push("start");
      onProgress("正在验证 key…");
      if (afterStart instanceof Error) throw afterStart;
      daemon.current = afterStart;
      return afterStart;
    },
    async stop() {
      daemon.calls.push("stop");
      const was = daemon.current !== null || daemon.hung;
      daemon.current = null;
      daemon.hung = false;
      return was ? stopped : "not-running";
    },
    async request(cmd, params) {
      daemon.calls.push(cmd);
      if (daemon.current === null) throw new NotRunningError();
      if (cmd === "set-key") {
        const result = saveKey(params.key);
        if (result.ok) daemon.current = { ...daemon.current, ...READY };
        return result;
      }
      if (cmd === "forget-key") daemon.current = NO_KEY;
      return null;
    },
  };
  return daemon;
}

/** secrets：每次问 key 时依次给出的回答。可以是文字、要抛的错误，或者一个现算的函数 */
function harness({
  daemon = fakeDaemon(),
  interactive = true,
  env = {},
  secrets = [],
  confirms = [],
  keychain = () => true,
} = {}) {
  const output = { out: "", err: "" };
  const asked = [];
  const tails = [];
  const confirmed = [];
  const io = {
    out: (text) => {
      output.out += `${text}\n`;
    },
    err: (text) => {
      output.err += `${text}\n`;
    },
    env,
    interactive,
    color: false,
    version: "0.1.0",
    paths,
    daemon,
    now: () => new Date("2026-10-13T07:00:00.000Z"),
    timeZone: "Asia/Shanghai",
    openHistory,
    async askSecret(prompt) {
      asked.push(prompt);
      const next = secrets.shift();
      const answer = typeof next === "function" ? next() : next;
      if (answer instanceof Error) throw answer;
      return answer ?? "";
    },
    async tail(args) {
      tails.push(args);
      return 0;
    },
    async confirm(question) {
      confirmed.push(question);
      return confirms.shift() ?? false;
    },
    removeKeychainKey: keychain,
    sharedPreferencesFile: join(dir, "com.github.Electron.plist"),
    packageDir: paths.appDir,
  };
  return { io, output, asked, tails, confirmed, daemon, speakmore: (...argv) => run(argv, io) };
}

/** 假装以前存过一把 key */
const haveStoredKey = () => writeFileSync(paths.keyFile, "密文");

// ---------- 启动 ----------

test("不带参数：没在运行就启动，然后给出状态面板", async () => {
  const { speakmore, output, daemon } = harness();
  assert.equal(await speakmore(), 0);
  assert.deepEqual(daemon.calls, ["start", "recheck"]);
  assert.match(output.out, /正在启动/);
  assert.match(output.out, /SpeakMore 0\.1\.0 · 运行中/);
  assert.match(output.out, /按一下右 Option 键开始说话/);
});

test("已经在运行时不再启动一次，只给面板；start 和不带参数是一回事", async () => {
  for (const argv of [[], ["start"]]) {
    const { speakmore, output, daemon } = harness({ daemon: fakeDaemon({ running: READY }) });
    assert.equal(await speakmore(...argv), 0);
    assert.ok(!daemon.calls.includes("start"));
    assert.match(output.out, /运行中/);
  }
});

test("第一次用：先问 key，再启动；存好了直接能用；key 不出现在任何输出里", async () => {
  const saved = [];
  const daemon = fakeDaemon({
    afterStart: NO_KEY,
    saveKey: (key) => {
      saved.push(key);
      return { ok: true };
    },
  });
  // 等启动的那段时间里终端是照常回显的：要是到那时才想起来要 key，提前粘贴的人会看到 key 显示在屏幕上
  const whenAsked = () => {
    assert.deepEqual(daemon.calls, [], "问 key 的时候还没开始启动");
    return "AIza-my-secret";
  };
  const { speakmore, output, asked } = harness({ daemon, secrets: [whenAsked] });
  assert.equal(await speakmore(), 0);
  assert.deepEqual(daemon.calls, ["start", "set-key", "recheck"]);
  assert.deepEqual(saved, ["AIza-my-secret"]);
  assert.equal(asked.length, 1);
  // 去哪申请、存在哪，是和提示一起交给"不回显地问"的那一步的：要先关掉回显再让人看到"要 key 了"
  assert.match(asked[0], /aistudio\.google\.com\/apikey/);
  assert.doesNotMatch(output.out, /aistudio/);
  assert.match(output.out, /已保存，验证通过/);
  assert.match(output.out, /运行中/);
  assert.ok(!(output.out + output.err).includes("AIza-my-secret"));
});

test("已经有 key（存着的，或者环境变量给的）时直接启动，不问", async () => {
  haveStoredKey();
  const stored = harness();
  assert.equal(await stored.speakmore(), 0);
  assert.equal(stored.asked.length, 0);
  rmSync(paths.keyFile);

  const fromEnv = harness({ env: { GEMINI_API_KEY: "AIza-env" } });
  assert.equal(await fromEnv.speakmore(), 0);
  assert.equal(fromEnv.asked.length, 0);
});

test("问到的 key 样子不对（带换行、空格）：当场说、当场再问，不发给后台，内容不出现在输出里", async () => {
  const saved = [];
  const daemon = fakeDaemon({
    afterStart: NO_KEY,
    saveKey: (key) => {
      saved.push(key);
      return { ok: true };
    },
  });
  const { speakmore, output, asked } = harness({ daemon, secrets: ["two\nlines-SECRET", "AIza-good"] });
  assert.equal(await speakmore(), 0);
  assert.equal(asked.length, 2);
  assert.deepEqual(saved, ["AIza-good"]);
  assert.match(output.err, /这把 key 里有空格或换行/);
  assert.doesNotMatch(output.out + output.err, /SECRET/);
});

test("存着的 key 启动后发现已经不能用了：这时再问一把", async () => {
  haveStoredKey();
  const daemon = fakeDaemon({ afterStart: REVOKED_KEY });
  const { speakmore, asked, output } = harness({ daemon, secrets: ["AIza-new"] });
  assert.equal(await speakmore(), 0);
  assert.deepEqual(daemon.calls, ["start", "set-key", "recheck"]);
  assert.equal(asked.length, 1);
  assert.match(output.out, /运行中/);
});

test("不是 key 的问题时不问 key：模型名写错、环境变量里的 key 不对，都只在面板里说", async () => {
  haveStoredKey();
  const wrongModel = harness({ daemon: fakeDaemon({ afterStart: WRONG_MODEL }) });
  assert.equal(await wrongModel.speakmore(), 0);
  assert.equal(wrongModel.asked.length, 0);
  assert.match(wrongModel.output.out, /gemini-nope is not found/);
  assert.match(wrongModel.output.out, /speakmore config/);

  const badEnv = { ...REVOKED_KEY, key: { ...REVOKED_KEY.key, source: "env" } };
  const fromEnv = harness({ daemon: fakeDaemon({ afterStart: badEnv }), env: { GEMINI_API_KEY: "AIza-env" } });
  assert.equal(await fromEnv.speakmore(), 0);
  assert.equal(fromEnv.asked.length, 0);
  assert.match(fromEnv.output.out, /环境变量 GEMINI_API_KEY/);
});

test("key 不对时说明原因再问一次", async () => {
  const answers = [{ ok: false, problem: "这把 key 无效，检查有没有复制完整" }, { ok: true }];
  const daemon = fakeDaemon({ afterStart: NO_KEY, saveKey: () => answers.shift() });
  const { speakmore, output, asked } = harness({ daemon, secrets: ["wrong", "right"] });
  assert.equal(await speakmore(), 0);
  assert.equal(asked.length, 2);
  assert.match(output.err, /这把 key 无效/);
  assert.match(output.out, /运行中/);
});

test("问 key 时什么都没填或者按了 Ctrl-C：不纠缠，面板里说还差 key", async () => {
  for (const secret of ["", new Cancelled()]) {
    const daemon = fakeDaemon({ afterStart: NO_KEY });
    const { speakmore, output, asked } = harness({ daemon, secrets: [secret] });
    assert.equal(await speakmore(), 0);
    // 启动前问过一次、他没填，启动后就不再问第二遍
    assert.equal(asked.length, 1);
    assert.ok(!daemon.calls.includes("set-key"));
    assert.match(output.out, /还差 1 样/);
    assert.match(output.out, /speakmore key/);
  }
});

test("不是在终端里运行（脚本、管道）时不问 key，也不弹窗口", async () => {
  const daemon = fakeDaemon({ afterStart: { ...NO_KEY, ...{ permissions: NO_PERMISSIONS.permissions } } });
  const { speakmore, asked } = harness({ daemon, interactive: false });
  assert.equal(await speakmore(), 0);
  assert.equal(asked.length, 0);
  assert.ok(!daemon.calls.includes("show-settings"));
});

test("缺系统权限时把设置窗口打开，并在面板里说明", async () => {
  const daemon = fakeDaemon({ afterStart: NO_PERMISSIONS });
  const { speakmore, output } = harness({ daemon });
  assert.equal(await speakmore(), 0);
  assert.ok(daemon.calls.includes("show-settings"));
  assert.match(output.out, /还差 2 样/);
  assert.match(output.out, /已经打开设置窗口/);
});

test("启动不起来时把原因说出来，以非零退出", async () => {
  const daemon = fakeDaemon({ afterStart: new Error("SpeakMore 没能启动（退出码 2）") });
  const { speakmore, output } = harness({ daemon });
  assert.equal(await speakmore(), 1);
  assert.match(output.err, /没能启动（退出码 2）/);
});

// ---------- 停止、重启、状态 ----------

test("stop：在运行就停掉，没在运行就照实说，是强行结束的也照实说", async () => {
  const running = harness({ daemon: fakeDaemon({ running: READY }) });
  assert.equal(await running.speakmore("stop"), 0);
  assert.match(running.output.out, /已经停掉/);
  const idle = harness();
  assert.equal(await idle.speakmore("stop"), 0);
  assert.match(idle.output.out, /没有在运行/);
  const stuck = harness({ daemon: fakeDaemon({ hung: true, stopped: "killed" }) });
  assert.equal(await stuck.speakmore("stop"), 0);
  assert.match(stuck.output.out, /强行结束/);
});

test("restart：先停再起", async () => {
  const { speakmore, daemon, output } = harness({ daemon: fakeDaemon({ running: READY }) });
  assert.equal(await speakmore("restart"), 0);
  assert.deepEqual(daemon.calls.slice(0, 2), ["stop", "start"]);
  assert.match(output.out, /运行中/);
});

test("restart：它卡住不答话时照样能重启", async () => {
  haveStoredKey();
  const { speakmore, daemon, output } = harness({ daemon: fakeDaemon({ hung: true, stopped: "killed" }) });
  assert.equal(await speakmore("restart"), 0);
  assert.deepEqual(daemon.calls.slice(0, 2), ["stop", "start"]);
  assert.match(output.out, /运行中/);
});

test("正在运行的是装成应用的那一个：不代它重启（会被换成终端启动的，权限和 key 是另一套），说怎么办", async () => {
  const packaged = { ...READY, packaged: true };
  const restarting = harness({ daemon: fakeDaemon({ running: packaged }) });
  assert.equal(await restarting.speakmore("restart"), 1);
  assert.deepEqual(restarting.daemon.calls, []);
  assert.match(restarting.output.err, /SpeakMore\.app/);
  assert.match(restarting.output.err, /退出/);

  const configuring = harness({ daemon: fakeDaemon({ running: packaged }) });
  assert.equal(await configuring.speakmore("config", "set", "hotkey", "fn"), 0);
  assert.deepEqual(JSON.parse(readFileSync(paths.settingsFile, "utf8")), { hotkey: "fn" });
  assert.deepEqual(configuring.daemon.calls, []);
  assert.match(configuring.output.out, /SpeakMore\.app/);
  assert.doesNotMatch(configuring.output.out, /已经生效/);
});

test("它卡住不答话时，别的命令说清楚是卡住了、怎么停，不甩一屏调用栈", async () => {
  for (const argv of [[], ["status"], ["settings"]]) {
    const { speakmore, output } = harness({ daemon: fakeDaemon({ hung: true }) });
    assert.equal(await speakmore(...argv), 1);
    assert.match(output.err, /没有在 5 秒内回话/);
    assert.match(output.err, /speakmore stop/);
  }
});

test("命令做到一半它没了：照实说没有在运行", async () => {
  const daemon = fakeDaemon({ running: READY });
  daemon.request = async () => {
    throw new NotRunningError();
  };
  const { speakmore, output } = harness({ daemon });
  assert.equal(await speakmore("settings"), 1);
  assert.match(output.err, /没有在运行/);
});

test("status：只看不动；能用是 0，没在运行或还差东西是 1", async () => {
  const idle = harness();
  assert.equal(await idle.speakmore("status"), 1);
  // 只会让它重新查一遍系统权限，不会把它启动起来
  assert.deepEqual(idle.daemon.calls, ["recheck"]);
  assert.match(idle.output.out, /没有运行/);

  const ready = harness({ daemon: fakeDaemon({ running: READY }) });
  assert.equal(await ready.speakmore("status"), 0);
  assert.ok(!ready.daemon.calls.includes("show-settings"));

  const incomplete = harness({ daemon: fakeDaemon({ running: NO_KEY }) });
  assert.equal(await incomplete.speakmore("status"), 1);
});

test("status --json：给程序读的，一行 JSON，带运行状态、设置和统计", async () => {
  const { speakmore, output } = harness({ daemon: fakeDaemon({ running: READY }) });
  await speakmore("status", "--json");
  const parsed = JSON.parse(output.out);
  assert.equal(parsed.running, true);
  assert.equal(parsed.status.pid, 4321);
  assert.equal(parsed.settings.hotkey.value, "right_option");
  assert.deepEqual(parsed.stats, { today: null, total: null });
});

// ---------- key ----------

test("key：没在运行就先启动，问一把，存好", async () => {
  const saved = [];
  const daemon = fakeDaemon({
    afterStart: NO_KEY,
    saveKey: (key) => {
      saved.push(key);
      return { ok: true };
    },
  });
  const { speakmore, output } = harness({ daemon, secrets: ["AIza-new"] });
  assert.equal(await speakmore("key"), 0);
  assert.deepEqual(daemon.calls.slice(0, 2), ["start", "set-key"]);
  assert.deepEqual(saved, ["AIza-new"]);
  assert.match(output.out, /已保存，验证通过/);
});

test("key：验证不过时说明原因，以非零退出，不反复问", async () => {
  const daemon = fakeDaemon({
    running: READY,
    saveKey: () => ({ ok: false, problem: "连不上 Gemini，检查网络后再试" }),
  });
  const { speakmore, output, asked } = harness({ daemon, secrets: ["AIza-new"] });
  assert.equal(await speakmore("key"), 1);
  assert.equal(asked.length, 1);
  assert.match(output.err, /连不上 Gemini/);
});

test("key：什么都没读到时不去打扰后台应用", async () => {
  const daemon = fakeDaemon({ running: READY });
  const { speakmore, output } = harness({ daemon, secrets: [""] });
  assert.equal(await speakmore("key"), 1);
  assert.deepEqual(daemon.calls, []);
  assert.match(output.err, /没有读到 key/);
});

test("key：从管道喂进来的内容样子不对（比如多行）：不启动、不发给后台，内容不出现在输出里", async () => {
  const { speakmore, output, daemon } = harness({ secrets: ["line-one-SECRET\nline-two-SECRET"] });
  assert.equal(await speakmore("key"), 1);
  assert.deepEqual(daemon.calls, []);
  assert.match(output.err, /这把 key 里有空格或换行/);
  assert.doesNotMatch(output.out + output.err, /SECRET/);
});

test("key 后面直接跟着一把 key：不照做，也不把它再打一遍，提醒这样写会进 shell 历史", async () => {
  const { speakmore, output, daemon, asked } = harness({ daemon: fakeDaemon({ running: READY }) });
  assert.equal(await speakmore("key", "AIza-typed-SECRET"), 2);
  assert.deepEqual(daemon.calls, []);
  assert.equal(asked.length, 0);
  assert.match(output.err, /历史/);
  assert.doesNotMatch(output.out + output.err, /SECRET/);
});

test("key --forget：两种启动方式各存的那一份都删掉；在运行的话让它也忘掉", async () => {
  const seed = () => {
    writeFileSync(paths.keyFile, "密文");
    writeFileSync(paths.appKeyFile, "密文");
  };
  seed();
  const running = harness({ daemon: fakeDaemon({ running: READY }) });
  assert.equal(await running.speakmore("key", "--forget"), 0);
  assert.deepEqual(running.daemon.calls, ["forget-key"]);
  assert.deepEqual([existsSync(paths.keyFile), existsSync(paths.appKeyFile)], [false, false]);

  seed();
  const idle = harness();
  assert.equal(await idle.speakmore("key", "--forget"), 0);
  assert.deepEqual([existsSync(paths.keyFile), existsSync(paths.appKeyFile)], [false, false]);
  assert.deepEqual(idle.daemon.calls, []);
  assert.match(idle.output.out, /已经删掉/);
});

// ---------- 设置 ----------

test("config：列出每一项和文件位置", async () => {
  const { speakmore, output } = harness();
  assert.equal(await speakmore("config"), 0);
  assert.match(output.out, /hotkey\s+right_option/);
  assert.match(output.out, new RegExp(paths.settingsFile.replaceAll("/", "\\/")));
});

test("config set：存进文件；在运行的话重启让它生效", async () => {
  const { speakmore, output, daemon } = harness({ daemon: fakeDaemon({ running: READY }) });
  assert.equal(await speakmore("config", "set", "hotkey", "fn"), 0);
  assert.deepEqual(JSON.parse(readFileSync(paths.settingsFile, "utf8")), { hotkey: "fn" });
  assert.deepEqual(daemon.calls.slice(0, 2), ["stop", "start"]);
  assert.match(output.out, /hotkey 改成了 fn/);
  assert.match(output.out, /已经生效/);

  const idle = harness();
  assert.equal(await idle.speakmore("config", "set", "thinking", "low"), 0);
  assert.deepEqual(idle.daemon.calls, []);
  assert.match(idle.output.out, /下次启动生效/);
});

test("config set：重启之后 Gemini 不认这个值（比如模型名写错）：不说“已经生效”，说原因和怎么撤回", async () => {
  const daemon = fakeDaemon({ running: READY, afterStart: WRONG_MODEL });
  const { speakmore, output } = harness({ daemon });
  assert.equal(await speakmore("config", "set", "model", "gemini-nope"), 1);
  assert.doesNotMatch(output.out, /已经生效/);
  assert.match(output.err, /gemini-nope is not found/);
  assert.match(output.err, /speakmore config unset model/);
});

test("config set：重启时没连上 Gemini，新设置对不对还不知道：不说“已经生效”", async () => {
  const unverified = { ...READY, key: { ...READY.key, verified: false } };
  const { speakmore, output } = harness({ daemon: fakeDaemon({ running: READY, afterStart: unverified }) });
  assert.equal(await speakmore("config", "set", "model", "gemini-next"), 0);
  assert.doesNotMatch(output.out, /已经生效/);
  assert.match(output.out, /还没验证.*speakmore status/);
});

test("config set：还没启动过就先改设置时，建出来的目录同样只有自己进得去", async () => {
  rmSync(dir, { recursive: true });
  const { speakmore } = harness();
  assert.equal(await speakmore("config", "set", "hotkey", "fn"), 0);
  assert.equal(statSync(paths.home).mode & 0o777, 0o700);
});

test("config set：填错时说能填什么，不动文件，以 2 退出", async () => {
  const { speakmore, output } = harness();
  assert.equal(await speakmore("config", "set", "hotkey", "caps_lock"), 2);
  assert.match(output.err, /right_option \/ right_command \/ right_control \/ fn/);
  assert.equal(existsSync(paths.settingsFile), false);
  assert.equal(await speakmore("config", "set", "hotkey"), 2);
  assert.equal(await speakmore("config", "dance"), 2);
});

test("config set：这一项正被环境变量盖着时提醒一句", async () => {
  const { speakmore, output } = harness({ env: { SPEAKMORE_HOTKEY: "right_command" } });
  assert.equal(await speakmore("config", "set", "hotkey", "fn"), 0);
  assert.match(output.out, /SPEAKMORE_HOTKEY/);
});

test("config unset：回到默认值", async () => {
  const { speakmore, output } = harness();
  await speakmore("config", "set", "hotkey", "fn");
  assert.equal(await speakmore("config", "unset", "hotkey"), 0);
  assert.deepEqual(JSON.parse(readFileSync(paths.settingsFile, "utf8")), {});
  assert.match(output.out, /hotkey 回到了默认值 right_option/);
});

test("设置文件被改坏时，任何命令都先把这件事说清楚", async () => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(paths.settingsFile, "{ 坏了");
  const { speakmore, output, daemon } = harness();
  assert.equal(await speakmore(), 2);
  assert.match(output.err, /settings\.json/);
  assert.deepEqual(daemon.calls, []);
});

// ---------- 历史 ----------

function seedHistory() {
  const history = openHistory(paths.historyDb);
  const entry = (id, createdAt, refinedText) => ({
    id,
    status: "completed",
    refinedText,
    error: null,
    duration: 4,
    audioLocalPath: null,
    createdAt,
  });
  history.add(entry("a", "2026-10-12T01:05:00.000Z", "昨天说的"));
  history.add(entry("b", "2026-10-13T06:32:00.000Z", "今天说的"));
  history.close();
}

test("history：一次都没用过时说一句，不凭空建库", async () => {
  const { speakmore, output } = harness();
  assert.equal(await speakmore("history"), 0);
  assert.match(output.out, /还没有听写记录/);
  assert.equal(existsSync(paths.historyDb), false);
});

test("history：按天分组列出来；-n 限制条数；后台应用在不在运行都能看", async () => {
  seedHistory();
  const all = harness();
  assert.equal(await all.speakmore("history"), 0);
  assert.match(
    all.output.out,
    /今天 · 10 月 13 日\n {2}14:32 {2}今天说的\n\n昨天 · 10 月 12 日\n {2}09:05 {2}昨天说的/,
  );
  assert.deepEqual(all.daemon.calls, []);

  const one = harness();
  assert.equal(await one.speakmore("history", "-n", "1"), 0);
  assert.doesNotMatch(one.output.out, /昨天说的/);
  assert.match(one.output.out, /显示最近 1 条，共 2 条/);
});

test("history --json：原样给出记录", async () => {
  seedHistory();
  const { speakmore, output } = harness();
  await speakmore("history", "--json");
  assert.deepEqual(
    JSON.parse(output.out).map((entry) => entry.refinedText),
    ["今天说的", "昨天说的"],
  );
});

test("history -n 要是正整数", async () => {
  const { speakmore, output } = harness();
  assert.equal(await speakmore("history", "-n", "abc"), 2);
  assert.match(output.err, /-n/);
});

test("有历史时面板里带上今天和累计的数", async () => {
  seedHistory();
  const { speakmore, output } = harness({ daemon: fakeDaemon({ running: READY }) });
  await speakmore("status");
  assert.match(output.out, /累计\s+2 次 · 8 字 · 8 秒/);
});

// ---------- 卸载 ----------

/** 摆出装好并用过之后的样子，外加家目录以外的一个命令链接 */
function seedInstalled() {
  for (const file of [
    join(paths.binDir, "speakmore"),
    join(paths.appDir, "package.json"),
    join(paths.runtimeDir, "Electron.app", "Info.plist"),
    paths.settingsFile,
    paths.keyFile,
    paths.historyDb,
    join(paths.recordingsDir, "a.webm"),
    paths.logFile,
    join(paths.cacheDir, "GPUCache", "data_0"),
  ]) {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "x");
  }
  // 家目录以外的一处（比如 ~/.local/bin）
  outside = mkdtempSync(join(tmpdir(), "sm-bin-"));
  const link = join(outside, "speakmore");
  symlinkSync(join(paths.binDir, "speakmore"), link);
  // 同一个位置上不是我们的东西：别人的同名文件
  const foreign = join(outside, "not-ours");
  writeFileSync(foreign, "别人的");
  writeFileSync(paths.linksFile, `${link}\n${foreign}\n`);
  return { link, foreign };
}

test("uninstall --yes：停掉后台，整个目录、家目录以外的命令链接、钥匙串里的条目，一次删干净", async () => {
  const { link, foreign } = seedInstalled();
  const removedFromKeychain = [];
  const { speakmore, output, daemon } = harness({
    daemon: fakeDaemon({ running: READY }),
    keychain: () => {
      removedFromKeychain.push(true);
      return true;
    },
  });
  assert.equal(await speakmore("uninstall", "--yes"), 0);
  assert.deepEqual(daemon.calls, ["stop"]);
  assert.equal(existsSync(paths.home), false);
  assert.equal(existsSync(link), false);
  assert.equal(removedFromKeychain.length, 1);
  // 记在清单里、但不是指向我们的链接的东西，不碰
  assert.equal(readFileSync(foreign, "utf8"), "别人的");
  assert.match(output.out, /已经卸载/);
  assert.match(output.out, /钥匙串/);
  // 删不了的也照实说
  assert.match(output.out, /权限/);
  assert.doesNotMatch(output.out, /com\.github\.Electron/);
});

test("uninstall：运行环境在别处留的那个共用的偏好文件，有的话提一句，不删", async () => {
  seedInstalled();
  const { speakmore, output, io } = harness();
  // 测试里家目录就是临时目录本身，所以这个文件放在别处
  io.sharedPreferencesFile = join(outside, "com.github.Electron.plist");
  writeFileSync(io.sharedPreferencesFile, "plist");
  assert.equal(await speakmore("uninstall", "--yes"), 0);
  assert.match(output.out, /com\.github\.Electron\.plist 没有动/);
  assert.equal(existsSync(io.sharedPreferencesFile), true);
});

test("uninstall --keep-data：只删程序，设置、key、历史和录音留着，钥匙串也不动（留着的 key 要靠它解开）", async () => {
  const { link } = seedInstalled();
  const { speakmore, output } = harness({ keychain: () => assert.fail("不该动钥匙串") });
  assert.equal(await speakmore("uninstall", "--keep-data", "--yes"), 0);
  for (const kept of [paths.settingsFile, paths.keyFile, paths.historyDb, join(paths.recordingsDir, "a.webm")]) {
    assert.equal(existsSync(kept), true, kept);
  }
  for (const gone of [paths.binDir, paths.appDir, paths.runtimeDir, paths.cacheDir, paths.logFile, link]) {
    assert.equal(existsSync(gone), false, gone);
  }
  assert.match(output.out, /留着/);
});

test("uninstall：先说清楚要删什么再问一句；不答应就什么都不动", async () => {
  seedInstalled();
  const declined = harness({ daemon: fakeDaemon({ running: READY }), confirms: [false] });
  assert.equal(await declined.speakmore("uninstall"), 1);
  assert.equal(declined.confirmed.length, 1);
  assert.match(declined.output.out, /历史和录音/);
  assert.deepEqual(declined.daemon.calls, []);
  assert.equal(existsSync(paths.historyDb), true);

  const agreed = harness({ confirms: [true] });
  assert.equal(await agreed.speakmore("uninstall"), 0);
  assert.equal(existsSync(paths.home), false);
});

test("uninstall：不在终端里运行又没给 --yes 时不动手", async () => {
  seedInstalled();
  const { speakmore, output, confirmed } = harness({ interactive: false });
  assert.equal(await speakmore("uninstall"), 2);
  assert.equal(confirmed.length, 0);
  assert.match(output.err, /--yes/);
  assert.equal(existsSync(paths.historyDb), true);
});

test("uninstall：后台停不掉时不往下删（它还开着那些文件）", async () => {
  seedInstalled();
  const daemon = fakeDaemon({ running: READY });
  daemon.stop = async () => {
    throw new Error("SpeakMore 停不掉（进程号 4321）");
  };
  const { speakmore, output } = harness({ daemon });
  assert.equal(await speakmore("uninstall", "--yes"), 1);
  assert.match(output.err, /停不掉/);
  assert.equal(existsSync(paths.appDir), true);
});

test("uninstall：钥匙串里的条目删不掉时照样把别的删完，并说清楚剩了什么", async () => {
  seedInstalled();
  const { speakmore, output } = harness({
    keychain: () => {
      throw new Error("钥匙串锁着");
    },
  });
  assert.equal(await speakmore("uninstall", "--yes"), 0);
  assert.equal(existsSync(paths.home), false);
  assert.match(output.out, /钥匙串锁着/);
  assert.match(output.out, /钥匙串访问/);
});

// ---------- 其余 ----------

test("logs：把日志文件的最后几行打出来，-f 一直跟着；还没有日志时照实说", async () => {
  const empty = harness();
  assert.equal(await empty.speakmore("logs"), 0);
  assert.match(empty.output.out, /还没有日志/);

  mkdirSync(join(dir, "logs"), { recursive: true });
  writeFileSync(paths.logFile, "{}\n");
  const { speakmore, tails } = harness();
  await speakmore("logs");
  await speakmore("logs", "-n", "5", "-f");
  assert.deepEqual(tails, [
    ["-n", "40", paths.logFile],
    ["-n", "5", "-f", paths.logFile],
  ]);
});

test("settings：在运行时打开设置窗口；没在运行时说先启动", async () => {
  const running = harness({ daemon: fakeDaemon({ running: READY }) });
  assert.equal(await running.speakmore("settings"), 0);
  assert.deepEqual(running.daemon.calls, ["show-settings"]);
  const idle = harness();
  assert.equal(await idle.speakmore("settings"), 1);
  assert.match(idle.output.err, /speakmore/);
});

test("help 和 --help 列出全部命令；--version 给版本号", async () => {
  for (const argv of [["help"], ["--help"], ["-h"]]) {
    const { speakmore, output } = harness();
    assert.equal(await speakmore(...argv), 0);
    for (const command of [
      "start",
      "stop",
      "restart",
      "status",
      "key",
      "config",
      "history",
      "logs",
      "settings",
      "uninstall",
    ]) {
      assert.match(output.out, new RegExp(`speakmore ${command}`));
    }
  }
  const { speakmore, output } = harness();
  assert.equal(await speakmore("--version"), 0);
  assert.equal(output.out.trim(), "0.1.0");
});

test("不认识的命令和不认识的选项：说一声并指向 help，以 2 退出", async () => {
  const { speakmore, output, daemon } = harness();
  assert.equal(await speakmore("dance"), 2);
  assert.match(output.err, /dance/);
  assert.match(output.err, /speakmore help/);
  assert.equal(await speakmore("status", "--loud"), 2);
  assert.deepEqual(daemon.calls, []);
});
