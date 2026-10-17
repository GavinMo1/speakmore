import { closeSync, openSync, readSync, statSync, unwatchFile, watchFile } from "node:fs";

// speakmore logs 在没有 tail 的系统上（Windows）用的：先打最后几行，-f 时接着把新写进来的打出来，按 Ctrl-C 停。
// macOS 上照旧用系统的 tail。

/** 文件最后 lines 行（不到 lines 行就是全部） */
export function lastLines(text, lines) {
  const all = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  return all.slice(-lines).join("\n");
}

/** 从 from 这个位置读到文件末尾 */
function readFrom(file, from, size) {
  const length = size - from;
  if (length <= 0) return "";
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, length, from);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

/**
 * @param {string} file
 * @param {{ lines: number, follow: boolean, write: (text: string) => void, intervalMs?: number }} options
 * @returns {Promise<number>} 退出码；-f 时一直到 Ctrl-C 才回来
 */
export function tailFile(file, { lines, follow, write, intervalMs = 500 }) {
  let size = statSync(file).size;
  const head = lastLines(readFrom(file, 0, size), lines);
  if (head) write(`${head}\n`);
  if (!follow) return Promise.resolve(0);
  return new Promise((resolve) => {
    watchFile(file, { interval: intervalMs }, (current) => {
      // 日志被轮换（变小了）时从头读新的那一份
      if (current.size < size) size = 0;
      const added = readFrom(file, size, current.size);
      size = current.size;
      if (added) write(added);
    });
    process.once("SIGINT", () => {
      unwatchFile(file);
      resolve(0);
    });
  });
}
