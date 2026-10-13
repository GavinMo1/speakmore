import { chmodSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";

// 命令行和后台应用之间的控制通道：数据目录里的一个 Unix 套接字，只有这台机器上的同一个用户连得上。
// 一次连接一问一答，各是一行 JSON：
//   {"cmd": "status", "params": {…}}  →  {"ok": true, "result": …}  或  {"ok": false, "error": "…"}

/** 一条请求最长多少字节。正常的请求只有几十个字节，带 key 的那条也不到两百 */
const MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

/** 后台应用没有在运行 */
export class NotRunningError extends Error {
  constructor() {
    super("SpeakMore 没有在运行");
    this.name = "NotRunningError";
  }
}

// 前三个是根本没人在听；后两个是连上了又被掐断，只在它正在退出的那一瞬间会遇到
const NOT_RUNNING_CODES = new Set(["ENOENT", "ECONNREFUSED", "ENOTSOCK", "ECONNRESET", "EPIPE"]);

/**
 * 发一条命令，等它的回答。
 * @returns {Promise<unknown>} 对方处理函数的返回值
 * @throws {NotRunningError} 没有人在听
 */
export function requestControl(socketPath, cmd, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let received = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`SpeakMore 没有在 ${timeoutMs / 1000} 秒内回话（命令 ${cmd}）`));
    }, timeoutMs);
    const fail = (error) => {
      clearTimeout(timer);
      reject(NOT_RUNNING_CODES.has(error.code) ? new NotRunningError() : error);
    };

    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ cmd, params })}\n`));
    socket.on("data", (chunk) => {
      received += chunk;
    });
    socket.on("error", fail);
    socket.on("end", () => {
      clearTimeout(timer);
      // 接了连接却一句没回就断开：它正在退出，这次没来得及答
      if (received === "") {
        reject(new NotRunningError());
        return;
      }
      let reply;
      try {
        reply = JSON.parse(received);
      } catch {
        reject(new Error(`SpeakMore 的回答看不懂（命令 ${cmd}）`));
        return;
      }
      if (reply.ok) resolve(reply.result);
      else reject(new Error(reply.error));
    });
  });
}

/** 这个套接字上现在有没有人在听 */
async function isAlive(socketPath) {
  try {
    await requestControl(socketPath, "", {}, { timeoutMs: 1_000 });
  } catch (error) {
    if (error instanceof NotRunningError) return false;
  }
  // 有人答了话（哪怕答的是"不认识的命令"）或者占着不答，都算有人在
  return true;
}

/**
 * 开始在套接字上听命令。
 * @param {object} options
 * @param {string} options.socketPath
 * @param {Record<string, (params: object) => unknown>} options.handlers 命令名 → 处理函数，返回值就是回答
 * @param {{ warn: Function }} options.log
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
export async function startControlServer({ socketPath, handlers, log }) {
  if (await isAlive(socketPath)) throw new Error("已经有一个在运行了");
  // 走到这里说明文件即使在也没人听：是上次没能正常退出留下的
  rmSync(socketPath, { force: true });

  const server = createServer((socket) => {
    let received = "";
    let answered = false;
    const answer = (reply) => {
      if (answered) return;
      answered = true;
      socket.end(`${JSON.stringify(reply)}\n`);
    };

    socket.setEncoding("utf8");
    // 对方中途断开时这里会报错，没什么可做的，但不处理的话整个进程会被带崩
    socket.on("error", () => {});
    socket.on("data", async (chunk) => {
      if (answered) return;
      received += chunk;
      if (Buffer.byteLength(received) > MAX_REQUEST_BYTES) {
        answer({ ok: false, error: "请求太长" });
        return;
      }
      const end = received.indexOf("\n");
      if (end === -1) return;

      let request;
      try {
        request = JSON.parse(received.slice(0, end));
      } catch {
        answer({ ok: false, error: "请求不是一行 JSON" });
        return;
      }
      const handler = Object.hasOwn(handlers, request?.cmd) ? handlers[request.cmd] : null;
      if (!handler) {
        answer({ ok: false, error: `不认识的命令：${JSON.stringify(request?.cmd)}` });
        return;
      }
      try {
        answer({ ok: true, result: (await handler(request.params ?? {})) ?? null });
      } catch (error) {
        // 只记命令名：参数里可能有 key
        log.warn("control_failed", { cmd: request.cmd, error: String(error?.message ?? error).slice(0, 300) });
        answer({ ok: false, error: String(error?.message ?? error) });
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  chmodSync(socketPath, 0o600);

  return {
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          rmSync(socketPath, { force: true });
          resolve();
        });
      }),
  };
}
