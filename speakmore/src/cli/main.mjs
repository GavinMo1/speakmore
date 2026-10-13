import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ControlError, TimeoutError } from "../control.mjs";
import { openHistory } from "../history.mjs";
import { resolvePaths } from "../paths.mjs";
import { apiKeyProblem } from "../server/config.mjs";
import { resolveSettings, SETTINGS, saveSetting, unsetSetting } from "../settings.mjs";
import { askSecret, Cancelled } from "./ask-secret.mjs";
import { createDaemon } from "./daemon.mjs";
import { renderConfig, renderHistory, renderStatus } from "./render.mjs";

// speakmore 命令：把"装好依赖、编小帮手、起后台应用、填 key、看历史、改设置"收成几个子命令。
// 真正干活的是后台应用（src/app），这里通过控制通道指挥它；历史和设置文件则直接读写。

const KEY_PAGE_URL = "https://aistudio.google.com/apikey";
const MAX_KEY_ATTEMPTS = 3;
/** 存 key 时后台应用要拿它去问一次 Gemini，那边的超时是 30 秒 */
const SAVE_KEY_TIMEOUT_MS = 45_000;
const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_LOG_LINES = 40;

const HELP = `SpeakMore：按一下热键说话，整理好的文字贴进当前输入框。

  speakmore                     启动（已经在运行就只显示状态）。第一次会问你要一把 Gemini API key
  speakmore start               同上
  speakmore stop                停掉
  speakmore restart             重启
  speakmore status [--json]     看状态：在不在运行、key、三项系统权限、今天和累计说了多少

  speakmore history [-n 条数] [--json]
                                看说过的话，按天分组，新的在前（默认最近 ${DEFAULT_HISTORY_LIMIT} 条）
  speakmore key                 换一把 key（输入不会显示出来；也可以从管道喂进来）
  speakmore key --forget        删掉存着的 key
  speakmore config              看设置：热键、模型、思考档位，以及数据和日志在哪
  speakmore config set <名字> <值>
  speakmore config unset <名字>  回到默认值
  speakmore settings            打开设置窗口（去系统设置授权时用）
  speakmore logs [-n 行数] [-f]  看日志，-f 一直跟着

  speakmore help                这段说明
  speakmore --version           版本号
`;

/** 命令敲错了：以 2 退出，并提示去看 help */
class UsageError extends Error {}
/** 设置写错了：以 2 退出 */
class ConfigError extends Error {}

function parse(args, options = {}) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(`参数不对：${error.message}`);
  }
}

function noPositionals(positionals, usage) {
  if (positionals.length > 0) throw new UsageError(`多了参数 ${positionals.join(" ")}。用法：${usage}`);
}

function positiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new UsageError(`${flag} 后面要跟一个正整数`);
  return number;
}

function currentSettings(io) {
  try {
    return resolveSettings({ file: io.paths.settingsFile, env: io.env });
  } catch (error) {
    throw new ConfigError(error.message);
  }
}

/** 今天和累计的统计。一次都没用过（库还不存在）时两项都是 null */
function readStats(io) {
  const history = io.openHistory(io.paths.historyDb, { readOnly: true });
  if (history === null) return { today: null, total: null };
  try {
    const midnight = io.now();
    midnight.setHours(0, 0, 0, 0);
    return { today: history.stats({ since: midnight.toISOString() }), total: history.stats() };
  } finally {
    history.close();
  }
}

const renderOptions = (io) => ({ color: io.color, now: io.now(), timeZone: io.timeZone });

function showStatus(io, status, settings) {
  io.out(renderStatus({ status, version: io.version, settings, stats: readStats(io) }, renderOptions(io)));
}

function permissionMissing({ permissions }) {
  return permissions.microphone !== "granted" || permissions.listen === false || permissions.trusted === false;
}

async function ensureRunning(io) {
  const status = await io.daemon.status();
  if (status !== null) return status;
  io.out("正在启动 SpeakMore…");
  return io.daemon.start({ onProgress: io.out });
}

const KEY_PROMPT = "粘贴 key 后按回车（输入不会显示出来）：";
/**
 * 问 key 之前的那几句说明。它不单独打印，而是和提示一起交给 askSecret：
 * 那一步会先关掉终端的回显再显示文字。否则手快的人看到"要 key 了"就粘贴，
 * 而回显还没关，key 会被终端原样显示出来（在伪终端里实测到过）。
 */
const keyPreamble = (skippable) =>
  [
    "",
    "需要一把 Gemini API key：录音是发给 Gemini 整理成文字的。",
    `没有的话在这里申请一把：${KEY_PAGE_URL}`,
    "它会用系统钥匙串加密后存在这台电脑上，不会发到别处。",
    ...(skippable ? ["现在不想填就直接按回车。"] : []),
    KEY_PROMPT,
  ].join("\n");

/**
 * 在终端里一把一把地问 key：每调一次给出一把样子没问题的，样子不对的当场说、当场再问。
 * 前后一共最多问 MAX_KEY_ATTEMPTS 次。
 * @returns {() => Promise<string | null>} null：没填、按了 Ctrl-C，或者已经问够了次数
 */
function keyPrompter(io) {
  let asked = 0;
  return async function nextKey() {
    while (asked < MAX_KEY_ATTEMPTS) {
      let value;
      try {
        value = await io.askSecret(asked++ === 0 ? keyPreamble(true) : KEY_PROMPT);
      } catch (error) {
        if (error instanceof Cancelled) return null;
        throw error;
      }
      if (value === "") return null;
      const problem = apiKeyProblem(value);
      if (problem === null) return value;
      io.err(`这把 key ${problem}。`);
    }
    return null;
  };
}

/** 把一把 key 交给后台应用验证并保存。@returns {Promise<boolean>} 通过了没有 */
async function submitKey(io, value) {
  io.out("正在验证…");
  const result = await io.daemon.request("set-key", { key: value }, { timeoutMs: SAVE_KEY_TIMEOUT_MS });
  if (result.ok) io.out("key 已保存，验证通过。");
  else io.err(`这把 key 没有通过：${result.problem}`);
  return result.ok;
}

/** 启动之前就看得出有 key 可用：存过、环境变量给了，或者 key 归单独启动的服务端管 */
const hasKeyAlready = (io) =>
  existsSync(io.paths.keyFile) || Boolean(io.env.GEMINI_API_KEY?.trim()) || Boolean(io.env.SPEAKMORE_SERVER_URL);

/**
 * 这种状态是不是填一把新的 key 就能解决。有两种不是：Gemini 拒绝了请求（多半是模型名或档位写错），
 * 和环境变量里的那把不对（存一把新的也没用，下次启动用的还是环境变量）。
 */
const needsNewKey = (key) =>
  key.state === "missing" ||
  key.state === "unreadable" ||
  (key.state === "rejected" && key.cause !== "other" && key.source !== "env");

const PACKAGED_NOTE = "现在运行的是装在“应用程序”里的 SpeakMore.app。";
const PACKAGED_RELAUNCH = "在菜单栏点“听写”→“退出”，再打开一次 SpeakMore.app";

// ---------- 各个子命令 ----------

async function start(args, io) {
  noPositionals(parse(args).positionals, "speakmore start");
  const settings = currentSettings(io);
  const nextKey = keyPrompter(io);

  let started = await io.daemon.status();
  /** 问到的第一把 key。undefined：还没问过；null：问了，没填 */
  let firstKey;
  if (started === null) {
    // 哪儿都没有 key 的话先问、再启动：启动要等一阵（第一次还要下载、点授权框），那段时间终端是照常回显的，
    // 到那时才问的话，提前粘贴的人会看到 key 显示在屏幕上
    if (io.interactive && !hasKeyAlready(io)) firstKey = await nextKey();
    io.out("正在启动 SpeakMore…");
    started = await io.daemon.start({ onProgress: io.out });
  }
  if (firstKey === undefined && io.interactive && needsNewKey(started.key)) firstKey = await nextKey();
  // 不填或取消都不纠缠，面板里会说还差它
  for (let value = firstKey ?? null; value !== null; value = await nextKey()) {
    if (await submitKey(io, value)) break;
  }
  // 重新查一遍系统权限：用户可能刚去系统设置里改过
  const status = (await io.daemon.status({ recheck: true })) ?? started;

  const openSettings = io.interactive && !status.starting && permissionMissing(status);
  if (openSettings) await io.daemon.request("show-settings");
  io.out("");
  showStatus(io, status, settings);
  if (openSettings) io.out("已经打开设置窗口，照着把缺的权限补上。补完运行 speakmore status 再看一眼。");
  return 0;
}

const STOPPED = {
  "not-running": "SpeakMore 本来就没有在运行。",
  quit: "SpeakMore 已经停掉。",
  killed: "SpeakMore 卡住了没有回应，已经强行结束。",
};

async function stop(args, io) {
  noPositionals(parse(args).positionals, "speakmore stop");
  io.out(STOPPED[await io.daemon.stop()]);
  return 0;
}

async function restart(args, io) {
  noPositionals(parse(args).positionals, "speakmore restart");
  currentSettings(io);
  let current = null;
  try {
    current = await io.daemon.status();
  } catch (error) {
    // 卡住不答话：正是要重启的时候，下面的 stop 会把它强行结束
    if (!(error instanceof TimeoutError)) throw error;
  }
  if (current?.packaged) {
    io.err(`${PACKAGED_NOTE}从命令行重启会把它换成终端启动的那一个，权限和 key 都是另一套。`);
    io.err(`要重启它：${PACKAGED_RELAUNCH}。`);
    return 1;
  }
  await io.daemon.stop();
  return start([], io);
}

async function status(args, io) {
  const { values, positionals } = parse(args, { json: { type: "boolean", default: false } });
  noPositionals(positionals, "speakmore status [--json]");
  const settings = currentSettings(io);
  const current = await io.daemon.status({ recheck: true });
  if (values.json) {
    io.out(JSON.stringify({ running: current !== null, status: current, settings, stats: readStats(io) }));
  } else {
    showStatus(io, current, settings);
  }
  return current?.summary.ready ? 0 : 1;
}

async function key(args, io) {
  const { values, positionals } = parse(args, { forget: { type: "boolean", default: false } });
  if (positionals.length > 0) {
    // 多出来的参数多半就是一把 key：不照做，也不把它再打一遍
    throw new UsageError(
      "key 不要写在命令后面：那样它会留在 shell 的历史记录里。运行 speakmore key 再粘贴，或者从管道喂：pbpaste | speakmore key",
    );
  }

  if (values.forget) {
    // 在运行的话让它把正在用的那把也放下；没在运行时不必为了删文件把它启动起来
    if ((await io.daemon.status()) !== null) await io.daemon.request("forget-key");
    // 命令启动的和装成应用的各存各的一份，都删
    for (const file of [io.paths.keyFile, io.paths.appKeyFile]) rmSync(file, { force: true });
    io.out("存着的 key 已经删掉。");
    return 0;
  }

  let value;
  try {
    value = await io.askSecret(keyPreamble(false));
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    io.err("已取消，key 没有改动。");
    return 1;
  }
  if (value === "") {
    io.err("没有读到 key，原来的没有改动。");
    return 1;
  }
  const problem = apiKeyProblem(value);
  if (problem !== null) {
    io.err(`这把 key ${problem}。原来的没有改动。`);
    return 1;
  }
  await ensureRunning(io);
  return (await submitKey(io, value)) ? 0 : 1;
}

/**
 * 设置改完之后让它生效：在运行就重启，并看重启之后的结果。
 * @param {string | null} undo 这次改动怎么撤回，重启后不能用时告诉用户；没有可撤回的时为 null
 * @returns {Promise<number>} 退出码
 */
async function applySettings(io, undo) {
  const current = await io.daemon.status();
  if (current === null) {
    io.out("下次启动生效。");
    return 0;
  }
  if (current.packaged) {
    // 从这里重启的话，起来的会是终端启动的那一个，不是它
    io.out(`${PACKAGED_NOTE}要让新设置生效：${PACKAGED_RELAUNCH}。`);
    return 0;
  }
  io.out("正在重启 SpeakMore 让它生效…");
  await io.daemon.stop();
  const restarted = await io.daemon.start({ onProgress: io.out });
  // 模型名、思考档位写得对不对，要问过 Gemini 才知道
  if (restarted.key.state === "rejected" && restarted.key.cause === "other") {
    io.err(`重启了，但现在不能用：${restarted.key.problem}`);
    if (undo) io.err(`想撤回这次改动：${undo}`);
    return 1;
  }
  if (restarted.starting) io.out("重启了，还没准备好：运行 speakmore status 看看。");
  else if (restarted.key.verified === false) {
    io.out("重启了，但没连上 Gemini，新设置对不对还没验证：过一会儿运行 speakmore status 看看。");
  } else io.out("已经生效。");
  return 0;
}

async function config(args, io) {
  const [action, name, value, ...extra] = parse(args).positionals;
  const file = io.paths.settingsFile;

  if (action === undefined) {
    io.out(renderConfig({ settings: currentSettings(io), paths: io.paths }, renderOptions(io)));
    return 0;
  }
  if (action === "set" && name !== undefined && value !== undefined && extra.length === 0) {
    let saved;
    try {
      saved = saveSetting(file, name, value);
    } catch (error) {
      throw new ConfigError(error.message);
    }
    io.out(`${name} 改成了 ${saved}。`);
    if (io.env[SETTINGS[name].env] !== undefined) {
      io.out(`注意：环境变量 ${SETTINGS[name].env} 现在设着，它会盖过这个值。`);
    }
    return applySettings(io, `speakmore config unset ${name}`);
  }
  if (action === "unset" && name !== undefined && value === undefined) {
    try {
      unsetSetting(file, name);
    } catch (error) {
      throw new ConfigError(error.message);
    }
    io.out(`${name} 回到了默认值 ${SETTINGS[name].default}。`);
    return applySettings(io, null);
  }
  throw new UsageError("用法：speakmore config | speakmore config set <名字> <值> | speakmore config unset <名字>");
}

async function history(args, io) {
  const { values, positionals } = parse(args, {
    limit: { type: "string", short: "n" },
    json: { type: "boolean", default: false },
  });
  noPositionals(positionals, "speakmore history [-n 条数] [--json]");
  const limit = values.limit === undefined ? DEFAULT_HISTORY_LIMIT : positiveInteger(values.limit, "-n");

  let rows = [];
  let total = 0;
  const db = io.openHistory(io.paths.historyDb, { readOnly: true });
  if (db !== null) {
    try {
      rows = db.list({ limit });
      const { dictations, failed } = db.stats();
      total = dictations + failed;
    } finally {
      db.close();
    }
  }
  io.out(values.json ? JSON.stringify(rows) : renderHistory({ rows, total }, renderOptions(io)));
  return 0;
}

async function logs(args, io) {
  const { values, positionals } = parse(args, {
    lines: { type: "string", short: "n", default: String(DEFAULT_LOG_LINES) },
    follow: { type: "boolean", short: "f", default: false },
  });
  noPositionals(positionals, "speakmore logs [-n 行数] [-f]");
  const lines = positiveInteger(values.lines, "-n");
  if (!existsSync(io.paths.logFile)) {
    io.out(`还没有日志：SpeakMore 启动过之后会写到 ${io.paths.logFile}`);
    return 0;
  }
  return io.tail(["-n", String(lines), ...(values.follow ? ["-f"] : []), io.paths.logFile]);
}

async function settings(args, io) {
  noPositionals(parse(args).positionals, "speakmore settings");
  if ((await io.daemon.status()) === null) {
    io.err("SpeakMore 没有在运行。先运行 speakmore 启动。");
    return 1;
  }
  await io.daemon.request("show-settings");
  io.out("设置窗口已经打开。");
  return 0;
}

const COMMANDS = { start, stop, restart, status, key, config, history, logs, settings };

/**
 * 执行一条命令。
 * @param {string[]} argv 命令名和它的参数（不含 node 和脚本路径）
 * @param {object} io 和外界打交道的全部途径，测试时整个换掉。真实的见 createIo
 * @returns {Promise<number>} 退出码：0 成功，1 没成，2 命令或设置写错了
 */
export async function run(argv, io) {
  try {
    if (argv.some((arg) => arg === "--help" || arg === "-h") || argv[0] === "help") {
      io.out(HELP);
      return 0;
    }
    if (argv[0] === "--version" || argv[0] === "-v") {
      io.out(io.version);
      return 0;
    }
    const [name = "start", ...rest] = argv;
    if (!Object.hasOwn(COMMANDS, name)) throw new UsageError(`没有 ${name} 这个命令。`);
    return await COMMANDS[name](rest, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      io.err("运行 speakmore help 看全部命令。");
      return 2;
    }
    if (error instanceof ConfigError) {
      io.err(error.message);
      return 2;
    }
    if (error instanceof ControlError) {
      io.err(error.message);
      if (error instanceof TimeoutError) {
        io.err("它可能卡住了。运行 speakmore stop 可以把它强行停掉，再运行 speakmore 重新启动。");
      }
      return 1;
    }
    // 自己抛出来的、带着一句人话的错误照直说；其余的是程序本身的毛病，连调用栈一起留给排查的人
    if (error?.constructor !== Error) throw error;
    io.err(error.message);
    return 1;
  }
}

/** 真实运行时的 io：标准输入输出、真的后台应用、真的历史库 */
export function createIo({ packageDir, env = process.env }) {
  const paths = resolvePaths(env);
  const write = (stream) => (text) => stream.write(text.endsWith("\n") ? text : `${text}\n`);
  return {
    out: write(process.stdout),
    err: write(process.stderr),
    env,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    // NO_COLOR 是通行的约定：设了就不上色
    color: Boolean(process.stdout.isTTY) && !env.NO_COLOR,
    version: JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version,
    paths,
    daemon: createDaemon({ paths, packageDir, env }),
    now: () => new Date(),
    timeZone: undefined,
    openHistory,
    askSecret,
    tail: (args) =>
      new Promise((resolveExit, reject) => {
        const child = spawn("tail", args, { stdio: "inherit" });
        child.on("error", reject);
        child.on("exit", (code) => resolveExit(code ?? 0));
      }),
  };
}

/** bin/speakmore.mjs 调的入口 */
export async function main(argv) {
  let io;
  try {
    io = createIo({ packageDir: resolve(import.meta.dirname, "../..") });
  } catch (error) {
    // 数据目录的路径不合用：还没有 io 可用，直接说
    console.error(error.message);
    return 2;
  }
  return run(argv, io);
}
