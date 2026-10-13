import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const PASTE_TIMEOUT_MS = 3_000;

/**
 * 启动原生小帮手（native/main.swift）并和它对话。两边用"一行一个 JSON"通信。
 * @param {string} command 可执行文件
 * @param {object} options
 * @param {string[]} [options.args]
 * @param {(event: object) => void} options.onEvent 收到 ready / hotkey / other_key，以及小帮手退出时的 exit
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

  child.on("error", (error) => {
    log.error("helper_spawn_failed", { command, error: String(error) });
    rejectAll(error);
  });
  child.on("exit", (code, signal) => {
    exited = true;
    rejectAll(new Error("原生小帮手退出了"));
    onEvent({ event: "exit", code, signal });
  });

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
    /** 关掉标准输入，小帮手会自己退出 */
    stop() {
      child.stdin.end();
    },
  };
}
