import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ControlError, TimeoutError } from "../control.mjs";
import {
  createTranslator,
  LocalizedError,
  localesFromEnv,
  msg,
  problemOf,
  resolveLocale,
  SYSTEM_LOCALE,
} from "../i18n/index.mjs";
import { log } from "../log.mjs";
import { createLocalModels } from "../models/library.mjs";
import { CHAT_VENDORS } from "../server/chat/vendors.mjs";
import { PROVIDERS } from "../server/providers/index.mjs";
import { openHistory } from "../storage/history.mjs";
import { migrateLegacyData } from "../storage/legacy.mjs";
import { resolvePaths } from "../storage/paths.mjs";
import { resolveSettings } from "../storage/settings.mjs";
import { THEMES } from "../themes/index.mjs";
import { askSecret, Cancelled } from "./ask-secret.mjs";
import { config, settings, theme } from "./commands/config.mjs";
import { DEFAULT_HISTORY_LIMIT, history } from "./commands/history.mjs";
import { key } from "./commands/key.mjs";
import { restart, start, status, stop } from "./commands/lifecycle.mjs";
import { polish, transcriber } from "./commands/local.mjs";
import { logs } from "./commands/logs.mjs";
import { mode } from "./commands/mode.mjs";
import { model } from "./commands/model.mjs";
import { uninstall } from "./commands/uninstall.mjs";
import { update } from "./commands/update.mjs";
import { usage } from "./commands/usage.mjs";
import { ConfigError, UsageError } from "./common.mjs";
import { createDaemon } from "./daemon.mjs";
import { createUpdater } from "./updater.mjs";

// speakmore 命令：把"装好依赖、编小帮手、起后台应用、填 key、看历史、改设置"收成几个子命令。
// 真正干活的是后台应用（src/app），这里通过控制通道指挥它；历史和设置文件则直接读写。
// 每个子命令在 commands/ 里一个文件，这里只管分发、收拾错误，以及真实运行时的 io。
// 说什么语言：设置里的 language，跟随系统时照命令行的惯例看 LC_ALL、LC_MESSAGES、LANG（src/i18n）。

/** speakmore help 的那段说明，按这一次的语言写 */
const help = (t) =>
  t("cli.help", {
    limit: DEFAULT_HISTORY_LIMIT,
    providers: PROVIDERS.map(({ id }) => id).join(" / "),
    polishers: CHAT_VENDORS.map(({ id }) => id).join(" / "),
    themes: THEMES.map(({ id }) => `${id} ${t(`themes.${id}.name`)}`).join(" / "),
  });

const COMMANDS = {
  start,
  stop,
  restart,
  status,
  update,
  key,
  mode,
  model,
  transcriber,
  polish,
  config,
  theme,
  history,
  usage,
  logs,
  settings,
  uninstall,
};

/**
 * 执行一条命令。
 * @param {string[]} argv 命令名和它的参数（不含 node 和脚本路径）
 * @param {object} io 和外界打交道的全部途径，测试时整个换掉。真实的见 createIo
 * @returns {Promise<number>} 退出码：0 成功，1 没成，2 命令或设置写错了
 */
export async function run(argv, io) {
  try {
    if (argv.some((arg) => arg === "--help" || arg === "-h") || argv[0] === "help") {
      io.out(help(io.t));
      return 0;
    }
    if (argv[0] === "--version" || argv[0] === "-v") {
      io.out(io.version);
      return 0;
    }
    const [name = "start", ...rest] = argv;
    if (!Object.hasOwn(COMMANDS, name)) throw new UsageError(msg("cli.unknownCommand", { name }));
    return await COMMANDS[name](rest, io);
  } catch (error) {
    const said = () => io.err(io.t.text(problemOf(error)));
    if (error instanceof UsageError) {
      said();
      io.err(io.t("cli.seeHelp"));
      return 2;
    }
    if (error instanceof ConfigError) {
      said();
      return 2;
    }
    if (error instanceof ControlError) {
      said();
      if (error instanceof TimeoutError) io.err(io.t("cli.stuck"));
      return 1;
    }
    // 自己抛出来的、带着一句人话的错误照直说；其余的是程序本身的毛病，连调用栈一起留给排查的人
    if (!(error instanceof LocalizedError) && error?.constructor !== Error) throw error;
    said();
    return 1;
  }
}

/** 删掉钥匙串里加密 key 用的那一条。@returns {boolean} 本来有没有 */
function removeKeychainKey(productName) {
  try {
    execFileSync("security", ["delete-generic-password", "-s", `${productName} Safe Storage`], { stdio: "pipe" });
    return true;
  } catch (error) {
    // 44：没有这一条
    if (error.status === 44) return false;
    throw new Error(String(error.stderr ?? "").trim() || error.message);
  }
}

/** 问一句普通的话（会回显，比如选用哪一家）。按 Ctrl-C 和问 key 时一样抛 Cancelled */
async function ask(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise((resolve, reject) => {
      // ^C 之后光标还停在提问那一行，换个行，后面的话不接在它后面
      prompt.once("SIGINT", () => {
        process.stderr.write("\n");
        reject(new Cancelled());
      });
      prompt.question(question).then(resolve, reject);
    });
  } finally {
    prompt.close();
  }
}

async function confirm(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await prompt.question(question)).trim());
  } finally {
    prompt.close();
  }
}

/**
 * 这一次命令行说什么语言：设置里写了就用它，跟随系统时看终端的语言。
 * 设置文件坏了的话先按终端的语言说：要读设置的命令接着会把坏在哪照实报出来
 */
function cliLocale(paths, env) {
  let setting = SYSTEM_LOCALE;
  try {
    setting = resolveSettings({ file: paths.settingsFile, env }).language.value;
  } catch {
    setting = SYSTEM_LOCALE;
  }
  return resolveLocale(setting, localesFromEnv(env));
}

/** 真实运行时的 io：标准输入输出、真的后台应用、真的历史库 */
export function createIo({ packageDir, env = process.env }) {
  const paths = resolvePaths(env);
  const t = createTranslator(cliLocale(paths, env));
  const write = (stream) => (text) => stream.write(text.endsWith("\n") ? text : `${text}\n`);
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  return {
    out: write(process.stdout),
    err: write(process.stderr),
    env,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    // NO_COLOR 是通行的约定：设了就不上色
    color: Boolean(process.stdout.isTTY) && !env.NO_COLOR,
    // 终端说自己支持 24 位色时，才画得出主题本来的颜色
    truecolor: Boolean(process.stdout.isTTY) && !env.NO_COLOR && /^(truecolor|24bit)$/.test(env.COLORTERM ?? ""),
    version: manifest.version,
    t,
    packageDir,
    paths,
    daemon: createDaemon({ paths, packageDir, env, locale: t.locale }),
    updater: createUpdater({ env, home: paths.home, progress: Boolean(process.stderr.isTTY) }),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // 后台没在运行时在这个进程里下载、删除本机模型
    localModels: ({ source, onChange }) =>
      createLocalModels({
        dir: paths.modelsDir,
        source,
        log: { info() {}, warn: log.warn, error: log.error },
        onChange,
      }),
    timeZone: undefined,
    openHistory,
    askSecret,
    ask,
    confirm,
    // 钥匙串里那一条的名字是 Electron 按应用名起的
    removeKeychainKey: () => removeKeychainKey(manifest.productName),
    // 自带的是原版 Electron，系统按它的应用标识在这里记了一份偏好。卸载时只提一句，不删：别的程序也在用
    sharedPreferencesFile: join(homedir(), "Library", "Preferences", "com.github.Electron.plist"),
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
    // 数据目录的路径不合用：还没有 io 可用，按终端的语言直接说
    const t = createTranslator(resolveLocale(SYSTEM_LOCALE, localesFromEnv(process.env)));
    console.error(t.text(problemOf(error)));
    return 2;
  }
  // 0.1 版的数据在别处，有的话先搬过来。只是问版本和帮助时不动
  if (!argv.some((arg) => ["--help", "-h", "help", "--version", "-v"].includes(arg))) {
    try {
      const moved = await migrateLegacyData({ paths: io.paths, log: { info() {}, warn: log.warn } });
      if (moved.length > 0) io.out(io.t("cli.migrated", { home: io.paths.home, items: moved.join(", ") }));
    } catch (error) {
      io.err(io.t.text(problemOf(error)));
      return 1;
    }
  }
  return run(argv, io);
}
