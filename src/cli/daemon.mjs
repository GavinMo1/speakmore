import { execFileSync, spawn as nodeSpawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { ALREADY_RUNNING_EXIT_CODE, NotRunningError, requestControl, TimeoutError } from "../control.mjs";
import { rotateIfLarge } from "../log.mjs";
import { ensureHome } from "../paths.mjs";
import { ensureHelper as defaultEnsureHelper } from "./native-helper.mjs";

// 后台应用（src/app，跑在 Electron 里）的起停。它脱离终端运行：关掉终端窗口它还在，
// 要靠控制通道才知道它在不在、状态如何。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 后台应用用哪个 Electron 来跑。
 * 装好的 SpeakMore 自带一份，这条命令本身就是拿它当 Node 跑起来的，所以正在跑我们的这个可执行文件就是它。
 * 从源码仓库跑（开发时）用的是系统的 Node，这时去依赖里找：electron 这个包导出的就是可执行文件的路径，
 * 没下载过的话它会在这一步自己去下载。
 */
function resolveElectronBinary(packageDir, onProgress) {
  if (process.versions.electron) return process.execPath;
  const require = createRequire(join(packageDir, "package.json"));
  let electronDir;
  try {
    electronDir = dirname(require.resolve("electron/package.json"));
  } catch {
    throw new Error(`找不到 Electron：依赖没有装全。在 ${packageDir} 里运行 npm install 再试。`);
  }
  if (!existsSync(join(electronDir, "dist"))) onProgress("第一次启动，正在下载运行环境 Electron（约 100 MB）…");
  try {
    return require("electron");
  } catch (error) {
    throw new Error(`Electron 没有下载成功（${error.message}）。检查网络后再运行一次。`);
  }
}

function logTail(file, lines = 8) {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch (error) {
    if (error.code === "ENOENT") return "（日志是空的）";
    throw error;
  }
}

/** 这个进程号现在跑的是什么命令；没有这个进程（或者查不了）时是 null */
function commandOfProcess(pid) {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim() || null;
  } catch {
    // 没有这个进程时 ps 以 1 退出。查不了就当不认识：宁可让用户自己去结束，也不结束一个说不清是谁的进程
    return null;
  }
}

/** 启动途中在等什么。只说用户看得见、需要他动手或等一下的那两种 */
function startingHint(status) {
  if (status.permissions?.microphone === "not-determined") {
    return "系统弹出了麦克风的授权框，点“允许”（框里写的是你这个终端程序的名字）。";
  }
  if (status.key?.state === "checking") return "正在验证 key…";
  return null;
}

/**
 * @param {object} options
 * @param {ReturnType<import("../paths.mjs").resolvePaths>} options.paths
 * @param {string} options.packageDir 这个包装在哪：Electron 以它为应用目录启动
 * @param {Record<string, string | undefined>} options.env 传给后台应用的环境
 */
export function createDaemon({
  paths,
  packageDir,
  env,
  spawn = nodeSpawn,
  resolveElectron = (onProgress) => resolveElectronBinary(packageDir, onProgress),
  ensureHelper = defaultEnsureHelper,
  kill = (pid, signal) => process.kill(pid, signal),
  commandOf = commandOfProcess,
  pollMs = 150,
  statusTimeoutMs = 5_000,
  connectTimeoutMs = 30_000,
  // 第一次启动要等用户点麦克风的授权框，所以给得宽
  readyTimeoutMs = 90_000,
  quitTimeoutMs = 5_000,
}) {
  const request = (cmd, params, options) => requestControl(paths.controlSocket, cmd, params, options);

  /**
   * @returns {Promise<object | null>} 没有在运行时是 null
   * @throws {TimeoutError} 在运行，但卡住了不答话
   */
  async function status(params = {}) {
    try {
      return await request("status", params, { timeoutMs: statusTimeoutMs });
    } catch (error) {
      if (error instanceof NotRunningError) return null;
      throw error;
    }
  }

  function isAlive(pid) {
    try {
      kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      // 进程在，只是不归我们管
      if (error.code === "EPERM") return true;
      throw error;
    }
  }

  /**
   * 等到这个进程真的不在了为止。只看控制通道关没关是不够的：它先关通道、过一会儿才退干净，
   * 这段时间里单实例的锁还占着，紧接着起新的会被挡回来。
   * @returns {Promise<boolean>} 限时内有没有等到
   */
  async function exited(pid, timeoutMs) {
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(pollMs)) {
      if (!isAlive(pid)) return true;
    }
    return !isAlive(pid);
  }

  /** 后台应用启动时记在数据目录里的进程号。没记、记的不是数字、那个号现在不像是它，都是 null */
  function recordedPid() {
    let text;
    try {
      text = readFileSync(paths.pidFile, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    const pid = Number(text.trim());
    if (!Number.isInteger(pid) || pid <= 1) return null;
    // 进程号会被系统分给别的程序，所以还要看它跑的是不是我们：命令启动的主进程是 …/MacOS/Electron，
    // 装成应用的是 …/MacOS/SpeakMore。只看有没有 "Electron" 字样不够，别的应用的辅助进程路径里也有
    return /\/MacOS\/(Electron|SpeakMore)( |$)/.test(commandOf(pid) ?? "") ? pid : null;
  }

  return {
    status,
    request,

    /**
     * 启动后台应用，等它准备好（key 验证完、麦克风的授权框有了回应）。调用前要确认它没有在运行。
     * @param {{ onProgress: (text: string) => void }} options 途中要让用户知道的事
     * @returns {Promise<object>} 启动后的状态；等得太久时 starting 仍是 true
     */
    async start({ onProgress }) {
      ensureHelper(packageDir, { onBuild: () => onProgress("第一次启动，正在编译按键监听的小程序…") });
      const electron = resolveElectron(onProgress);

      // 日志要写进家目录。先按规矩把它建出来：顺着日志的路径一路建的话，目录的权限会是默认的那种
      ensureHome(paths);
      rotateIfLarge(paths.logFile);
      const logFd = openSync(paths.logFile, "a");
      // 带着 ELECTRON_RUN_AS_NODE 的话 Electron 会把自己当成普通的 Node，窗口和热键都不会有
      const { ELECTRON_RUN_AS_NODE: _dropped, ...childEnv } = env;
      /** 我们启动的那个进程是怎么结束的；还在运行时是 null */
      let ended = null;
      const child = spawn(electron, [packageDir], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: { ...childEnv, SPEAKMORE_CLI: "1" },
      });
      child.on("exit", (code, signal) => {
        ended = { code, reason: signal ? `被信号 ${signal} 结束` : `退出码 ${code}` };
      });
      child.on("error", (error) => {
        ended = { code: null, reason: String(error.message) };
      });
      child.unref();
      closeSync(logFd);

      // 另一条 speakmore 命令抢先启动了一个，我们这个发现后自己退出：不算失败，接着等抢先的那个
      const lostRace = () => ended?.code === ALREADY_RUNNING_EXIT_CODE;
      const failed = () =>
        new Error(
          `SpeakMore 没能启动（${ended && !lostRace() ? ended.reason : "中途退出"}）。日志 ${paths.logFile} 的最后几行：\n${logTail(paths.logFile)}`,
        );

      let current = null;
      for (const deadline = Date.now() + connectTimeoutMs; current === null; await sleep(pollMs)) {
        current = await status();
        if (current !== null) break;
        if (ended && !lostRace()) throw failed();
        if (Date.now() > deadline) {
          throw new Error(`SpeakMore 启动后 ${connectTimeoutMs / 1000} 秒没有答话。看看日志：${paths.logFile}`);
        }
      }

      const said = new Set();
      for (const deadline = Date.now() + readyTimeoutMs; current.starting && Date.now() < deadline; ) {
        const hint = startingHint(current);
        if (hint && !said.has(hint)) {
          said.add(hint);
          onProgress(hint);
        }
        await sleep(pollMs);
        current = await status();
        if (current === null) throw failed();
      }
      return current;
    },

    /**
     * 停掉后台应用，等它的进程真的不在了才返回。先请它自己退出，不退再结束进程；
     * 它卡住不答话时，照它启动时记下的进程号结束。
     * @returns {Promise<"not-running" | "quit" | "killed">} 本来就没在运行 / 它自己退出了 / 是被结束掉的
     */
    async stop() {
      let pid = null;
      let answering = true;
      try {
        const current = await status();
        if (current === null) return "not-running";
        pid = current.pid;
        await request("quit");
      } catch (error) {
        if (error instanceof TimeoutError) {
          answering = false;
          pid ??= recordedPid();
          if (pid === null) {
            throw new Error(
              "SpeakMore 卡住了不答话，也认不出它的进程号。在“活动监视器”里找到名叫 Electron 或 SpeakMore 的进程，结束它。",
            );
          }
          // 答了"在运行"之后、收到退出命令之前它自己没了，不算错
        } else if (!(error instanceof NotRunningError)) throw error;
      }

      if (answering && (await exited(pid, quitTimeoutMs))) return "quit";
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        try {
          kill(pid, signal);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
        if (await exited(pid, quitTimeoutMs)) return "killed";
      }
      throw new Error(`SpeakMore 停不掉（进程号 ${pid}）。在“活动监视器”里结束它。`);
    },
  };
}
