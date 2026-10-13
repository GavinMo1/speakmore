import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Cancelled } from "../../src/cli/ask-secret.mjs";
import { run } from "../../src/cli/main.mjs";
import { openHistory } from "../../src/history.mjs";
import { resolvePaths } from "../../src/paths.mjs";

const READY = {
  pid: 4321,
  version: "0.1.0",
  starting: false,
  hotkey: "right_option",
  hotkeyLabel: "右 Option 键",
  key: { state: "ready", source: "stored", problem: null },
  permissions: { microphone: "granted", listen: true, trusted: true },
  summary: { ready: true, missing: [], blocker: null, degraded: null },
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
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-"));
  paths = resolvePaths({ SPEAKMORE_HOME: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * 假的后台应用。running 是它现在的状态（null 表示没在运行），afterStart 是启动之后的状态，
 * saveKey 决定存 key 的结果。calls 记下命令行对它做过什么。
 */
function fakeDaemon({ running = null, afterStart = READY, saveKey = () => ({ ok: true }) } = {}) {
  const daemon = {
    calls: [],
    current: running,
    async status(params = {}) {
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
      const was = daemon.current !== null;
      daemon.current = null;
      return was;
    },
    async request(cmd, params) {
      daemon.calls.push(cmd);
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

function harness({ daemon = fakeDaemon(), interactive = true, env = {}, secrets = [] } = {}) {
  const output = { out: "", err: "" };
  const asked = [];
  const tails = [];
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
      if (next instanceof Error) throw next;
      return next ?? "";
    },
    async tail(args) {
      tails.push(args);
      return 0;
    },
  };
  return { io, output, asked, tails, daemon, speakmore: (...argv) => run(argv, io) };
}

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

test("第一次用：没有 key 就在终端里问，存好了直接能用；key 不出现在任何输出里", async () => {
  const saved = [];
  const daemon = fakeDaemon({
    afterStart: NO_KEY,
    saveKey: (key) => {
      saved.push(key);
      return { ok: true };
    },
  });
  const { speakmore, output, asked } = harness({ daemon, secrets: ["AIza-my-secret"] });
  assert.equal(await speakmore(), 0);
  assert.deepEqual(saved, ["AIza-my-secret"]);
  assert.equal(asked.length, 1);
  assert.match(output.out, /aistudio\.google\.com\/apikey/);
  assert.match(output.out, /已保存，验证通过/);
  assert.match(output.out, /运行中/);
  assert.ok(!(output.out + output.err).includes("AIza-my-secret"));
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
    const { speakmore, output } = harness({ daemon, secrets: [secret] });
    assert.equal(await speakmore(), 0);
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

test("stop：在运行就停掉，没在运行就照实说", async () => {
  const running = harness({ daemon: fakeDaemon({ running: READY }) });
  assert.equal(await running.speakmore("stop"), 0);
  assert.match(running.output.out, /已经停掉/);
  const idle = harness();
  assert.equal(await idle.speakmore("stop"), 0);
  assert.match(idle.output.out, /没有在运行/);
});

test("restart：先停再起", async () => {
  const { speakmore, daemon, output } = harness({ daemon: fakeDaemon({ running: READY }) });
  assert.equal(await speakmore("restart"), 0);
  assert.deepEqual(daemon.calls.slice(0, 2), ["stop", "start"]);
  assert.match(output.out, /运行中/);
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

test("key --forget：在运行时让它忘掉；没在运行时直接删掉存着的文件", async () => {
  const running = harness({ daemon: fakeDaemon({ running: READY }) });
  assert.equal(await running.speakmore("key", "--forget"), 0);
  assert.deepEqual(running.daemon.calls, ["forget-key"]);

  writeFileSync(paths.keyFile, "密文");
  const idle = harness();
  assert.equal(await idle.speakmore("key", "--forget"), 0);
  assert.equal(existsSync(paths.keyFile), false);
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

  const idle = harness();
  assert.equal(await idle.speakmore("config", "set", "thinking", "low"), 0);
  assert.deepEqual(idle.daemon.calls, []);
  assert.match(idle.output.out, /下次启动生效/);
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
    for (const command of ["start", "stop", "restart", "status", "key", "config", "history", "logs", "settings"]) {
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
