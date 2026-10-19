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
 * 跑一条命令等它结束。说的话：stdio 是 "inherit" 时直接接在终端上（命令行），是 "forward" 时经管道转到这个进程的
 * 标准输出、标准错误上（App 起的更新进程，它的输出接着日志）。转一道是为了 Windows：子进程的标准输入输出都不是
 * 继承来的，Node 才会让它不带控制台窗口地起（CREATE_NO_WINDOW）；继承的话 PowerShell、curl 会新开一个控制台，
 * 默认终端是 Windows Terminal 的机器上可能闪出一个窗口
 * @param {{ env: object, stdio: "inherit" | "forward", shell?: boolean }} options
 * @returns {Promise<number>} 退出码；被信号打断、没有退出码的算 1
 */
export function runToEnd(command, args, { env, stdio, shell = false }) {
  return new Promise((resolve, reject) => {
    const forward = stdio === "forward";
    const child = spawn(command, args, {
      stdio: forward ? ["ignore", "pipe", "pipe"] : stdio,
      env,
      shell,
      windowsHide: true,
    });
    if (forward) {
      child.stdout.pipe(process.stdout, { end: false });
      child.stderr.pipe(process.stderr, { end: false });
    }
    child.on("error", reject);
    // 等它退出就算完，不等管道关上：它起的、还会接着跑一阵的孙进程（install.ps1 交给后台慢慢删旧目录的那个，
    // 正等着这个进程退出）要是继承了管道，等管道关上就是互相等。之后转过来的几行照样进日志
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
