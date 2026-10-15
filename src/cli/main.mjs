import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ControlError, TimeoutError } from "../control.mjs";
import { log } from "../log.mjs";
import { PROVIDERS } from "../server/providers/index.mjs";
import { openHistory } from "../storage/history.mjs";
import { migrateLegacyData } from "../storage/legacy.mjs";
import { resolvePaths } from "../storage/paths.mjs";
import { THEMES } from "../themes/index.mjs";
import { askSecret, Cancelled } from "./ask-secret.mjs";
import { config, settings, theme } from "./commands/config.mjs";
import { DEFAULT_HISTORY_LIMIT, history } from "./commands/history.mjs";
import { key } from "./commands/key.mjs";
import { restart, start, status, stop } from "./commands/lifecycle.mjs";
import { logs } from "./commands/logs.mjs";
import { model } from "./commands/model.mjs";
import { uninstall } from "./commands/uninstall.mjs";
import { usage } from "./commands/usage.mjs";
import { ConfigError, UsageError } from "./common.mjs";
import { createDaemon } from "./daemon.mjs";

// speakmore 命令：把"装好依赖、编小帮手、起后台应用、填 key、看历史、改设置"收成几个子命令。
// 真正干活的是后台应用（src/app），这里通过控制通道指挥它；历史和设置文件则直接读写。
// 每个子命令在 commands/ 里一个文件，这里只管分发、收拾错误，以及真实运行时的 io。

const HELP = `SpeakMore：按一下热键说话，整理好的文字贴进当前输入框。

  speakmore                     启动（已经在运行就只显示状态）。第一次会问你要一把 API key（默认用 Gemini）
  speakmore start               同上
  speakmore stop                停掉
  speakmore restart             重启
  speakmore status [--json]     看状态：在不在运行、key、三项系统权限、今天和累计说了多少

  speakmore history [-n 条数] [--json]
                                看说过的话，按天分组，新的在前（默认最近 ${DEFAULT_HISTORY_LIMIT} 条）
  speakmore usage [--json]      看花了多少钱：今天、本月、累计的花费、token，模型多久回话，按型号分开
  speakmore model               看能用哪几家的模型（${PROVIDERS.map(({ id }) => id).join(" / ")}）、各家的 key 有没有、现在用的哪个
  speakmore model <厂商>[/<模型>]
                                换一家或换个模型，比如 speakmore model openai。没有它的 key 会先问
  speakmore model check [<厂商>[/<模型>]]
                                检查能不能用：拿那一家的 key 发一个最小的请求。不写就查现在用的
  speakmore key [<厂商>]         换一把 key，不写厂商就是现在用的那家（输入不会显示出来；也可以从管道喂进来）
  speakmore key --forget [<厂商>]
                                删掉存着的 key
  speakmore config              看设置：热键、模型、思考档位、主题，以及数据和日志在哪
  speakmore config set <名字> <值>
  speakmore config unset <名字>  回到默认值
  speakmore theme               看有哪几套主题、现在用的哪套
  speakmore theme <名字>         换一套（${THEMES.map((theme) => `${theme.id} ${theme.name}`).join(" / ")}），当场生效不用重启
  speakmore settings            打开设置（去系统设置授权时用）
  speakmore logs [-n 行数] [-f]  看日志，-f 一直跟着
  speakmore uninstall [--keep-data] [--yes]
                                卸载：停掉后台，把 SpeakMore 的目录整个删掉。--keep-data 留下设置、key、历史和录音

  speakmore help                这段说明
  speakmore --version           版本号
`;

const COMMANDS = { start, stop, restart, status, key, model, config, theme, history, usage, logs, settings, uninstall };

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

/** 真实运行时的 io：标准输入输出、真的后台应用、真的历史库 */
export function createIo({ packageDir, env = process.env }) {
  const paths = resolvePaths(env);
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
    packageDir,
    paths,
    daemon: createDaemon({ paths, packageDir, env }),
    now: () => new Date(),
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
    // 数据目录的路径不合用：还没有 io 可用，直接说
    console.error(error.message);
    return 2;
  }
  // 0.1 版的数据在别处，有的话先搬过来。只是问版本和帮助时不动
  if (!argv.some((arg) => ["--help", "-h", "help", "--version", "-v"].includes(arg))) {
    try {
      const moved = await migrateLegacyData({ paths: io.paths, log: { info() {}, warn: log.warn } });
      if (moved.length > 0) io.out(`旧版本的数据已经搬到 ${io.paths.home}（${moved.join("、")}）。`);
    } catch (error) {
      io.err(error.message);
      return 1;
    }
  }
  return run(argv, io);
}
