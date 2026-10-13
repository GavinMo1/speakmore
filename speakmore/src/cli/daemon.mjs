import { spawn as nodeSpawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { NotRunningError, requestControl } from "../control.mjs";
import { rotateIfLarge } from "../log.mjs";
import { ensureHelper as defaultEnsureHelper } from "./native-helper.mjs";

// 后台应用（src/app，跑在 Electron 里）的起停。它脱离终端运行：关掉终端窗口它还在，
// 要靠控制通道才知道它在不在、状态如何。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** electron 这个包导出的就是可执行文件的路径；没下载过的话它会在这一步自己去下载 */
function resolveElectronBinary(packageDir, onProgress) {
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
  pollMs = 150,
  connectTimeoutMs = 30_000,
  // 第一次启动要等用户点麦克风的授权框，所以给得宽
  readyTimeoutMs = 90_000,
  quitTimeoutMs = 5_000,
}) {
  const request = (cmd, params, options) => requestControl(paths.controlSocket, cmd, params, options);

  /** @returns {Promise<object | null>} 没有在运行时是 null */
  async function status(params = {}) {
    try {
      return await request("status", params);
    } catch (error) {
      if (error instanceof NotRunningError) return null;
      throw error;
    }
  }

  /** 等到它不在了为止。@returns {Promise<boolean>} 限时内有没有等到 */
  async function gone(timeoutMs) {
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(pollMs)) {
      if ((await status()) === null) return true;
    }
    return (await status()) === null;
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

      rotateIfLarge(paths.logFile);
      const logFd = openSync(paths.logFile, "a");
      // 带着 ELECTRON_RUN_AS_NODE 的话 Electron 会把自己当成普通的 Node，窗口和热键都不会有
      const { ELECTRON_RUN_AS_NODE: _dropped, ...childEnv } = env;
      let exited = null;
      const child = spawn(electron, [packageDir], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: { ...childEnv, SPEAKMORE_CLI: "1" },
      });
      child.on("exit", (code, signal) => {
        exited = signal ? `被信号 ${signal} 结束` : `退出码 ${code}`;
      });
      child.on("error", (error) => {
        exited = String(error.message);
      });
      child.unref();
      closeSync(logFd);

      const failed = () =>
        new Error(
          `SpeakMore 没能启动（${exited ?? "中途退出"}）。日志 ${paths.logFile} 的最后几行：\n${logTail(paths.logFile)}`,
        );

      let current = null;
      for (const deadline = Date.now() + connectTimeoutMs; current === null; await sleep(pollMs)) {
        current = await status();
        if (current !== null) break;
        if (exited) throw failed();
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
     * 停掉后台应用。先请它自己退出，不退再结束进程。
     * @returns {Promise<boolean>} 之前有没有在运行
     */
    async stop() {
      const current = await status();
      if (current === null) return false;
      try {
        await request("quit");
      } catch (error) {
        if (!(error instanceof NotRunningError)) throw error;
      }
      if (await gone(quitTimeoutMs)) return true;
      kill(current.pid, "SIGTERM");
      if (await gone(quitTimeoutMs)) return true;
      throw new Error(`SpeakMore 停不掉（进程号 ${current.pid}）。可以手动结束它：kill -9 ${current.pid}`);
    },
  };
}
