import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

const PASTE_TIMEOUT_MS = 3_000;

/**
 * 小帮手的源码、编好的可执行文件、指纹文件在哪。App 启动时要用，所以放在这一层：
 * Mac 的 .app 里不带 src/cli（scripts/build/stage-app.mjs 的 MAC_APP_IGNORE），从那里引就打不开。
 * 怎么编、什么时候要重编在 src/cli/native-helper.mjs
 * @param {string} packageDir
 * @param {NodeJS.Platform} [platform] 给哪个系统的
 */
export function helperPaths(packageDir, platform = process.platform) {
  const windows = platform === "win32";
  const binary = join(packageDir, "build", windows ? "key-helper.exe" : "key-helper");
  return {
    // 两个系统的都是一个目录：Windows 的是 Go 模块，macOS 的是几个 Swift 文件
    source: join(packageDir, "native", windows ? "windows" : "mac"),
    binary,
    /** 可执行文件是从哪份源码编出来的：那份源码的 SHA-256 */
    stamp: `${binary}.source-sha256`,
  };
}

/**
 * 启动原生小帮手（native/mac/、native/windows/）并和它对话。两边用"一行一个 JSON"通信。
 * @param {string} command 可执行文件
 * @param {object} options
 * @param {string[]} [options.args]
 * @param {(event: object) => void} options.onEvent 收到 ready / hotkey / other_key / escape / click，
 *   以及小帮手不在了（退出或根本没起来）时的 exit，只报一次
 * @param {{ warn: Function, error: Function }} options.log
 */
export function startHelper(command, { args = [], onEvent, log }) {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
  /** 发出去还没回的粘贴请求：id → { resolve, reject, timer } */
  const pending = new Map();
  let nextId = 1;
  let exited = false;

  const rejectAll = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };

  createInterface({ input: child.stdout }).on("line", (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      log.warn("helper_bad_line", { line: line.slice(0, 200) });
      return;
    }
    if (event.event === "pasted") {
      const request = pending.get(event.id);
      if (!request) return;
      pending.delete(event.id);
      clearTimeout(request.timer);
      request.resolve({ ok: event.ok, reason: event.reason ?? null });
    } else if (event.event === "error") {
      log.error("helper_error", { message: event.message });
    } else {
      onEvent(event);
    }
  });
  createInterface({ input: child.stderr }).on("line", (line) => log.warn("helper_stderr", { line }));

  /** 它不在了：等着的粘贴全部失败，并往上报一次。启动不起来和中途退出都走这里 */
  const gone = (reason, code = null, signal = null) => {
    if (exited) return;
    exited = true;
    rejectAll(reason);
    onEvent({ event: "exit", code, signal });
  };

  child.on("error", (error) => {
    // 可执行文件不存在或没有执行权限时只有这个事件，不会再有 exit
    log.error("helper_spawn_failed", { command, error: String(error) });
    gone(error);
  });
  child.on("exit", (code, signal) => gone(new Error("原生小帮手退出了"), code, signal));

  return {
    /**
     * 把文字贴进当前输入框。
     * @returns {Promise<{ ok: boolean, reason: string | null }>} ok 为 false 时文字留在剪贴板里
     */
    paste(text) {
      if (exited) return Promise.reject(new Error("原生小帮手没有在运行"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("粘贴没有在限时内完成"));
        }, PASTE_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ cmd: "paste", id, text })}\n`);
      });
    },
    /**
     * 听写进行中：把 esc 和这几块里的鼠标点击截下来，不让别的应用收到。截到了会报 escape / click。
     * 小帮手不在了就什么也不做：那时热键本身也不灵，上面已经报过了。
     * @param {{ id: string, x: number, y: number, width: number, height: number }[]} regions 屏幕坐标
     */
    capture(regions) {
      if (!exited) child.stdin.write(`${JSON.stringify({ cmd: "capture", regions })}\n`);
    },
    /** 不截了 */
    release() {
      if (!exited) child.stdin.write(`${JSON.stringify({ cmd: "release" })}\n`);
    },
    /** 关掉标准输入，小帮手会自己退出 */
    stop() {
      child.stdin.end();
    },
  };
}
