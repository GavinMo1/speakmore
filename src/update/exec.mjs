import { execFile, spawn } from "node:child_process";

/** 跑一条命令，交出标准输出。失败时抛出的错误上带着它在标准错误里说的（said） */
export function run(command, args, { env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", env, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      error.said = stderr.trim() || error.message;
      reject(error);
    });
  });
}

/**
 * 跑一条命令等它结束，输出照 stdio 接（接到终端上，或者写进日志）。
 * @returns {Promise<number>} 退出码；被信号打断、没有退出码的算 1
 */
export function runToEnd(command, args, { env, stdio, shell = false }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio, env, shell, windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
