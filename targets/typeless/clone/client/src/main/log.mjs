// 每条日志一行 JSON，和服务端的格式一样：时间、级别、事件名，加上当时的上下文。
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
let logFile = null;

/**
 * 日志同时写进一个文件。装成应用后没有终端可看，排查问题靠它。
 * 启动时文件超过 5 MB 就改名成 .old 留作上一份，重新开始写。
 */
export function alsoLogTo(file) {
  mkdirSync(dirname(file), { recursive: true });
  try {
    if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.old`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  logFile = file;
}

function write(stream, level, event, fields) {
  const line = `${JSON.stringify({ t: new Date().toISOString(), level, event, ...fields })}\n`;
  stream.write(line);
  if (logFile === null) return;
  try {
    appendFileSync(logFile, line);
  } catch (error) {
    // 文件写不了（磁盘满、目录被删）不能连累正常功能：停掉文件这一路，在标准错误里留一句
    const failedFile = logFile;
    logFile = null;
    process.stderr.write(
      `${JSON.stringify({ t: new Date().toISOString(), level: "error", event: "log_file_failed", file: failedFile, error: String(error) })}\n`,
    );
  }
}

export const log = {
  info: (event, fields = {}) => write(process.stdout, "info", event, fields),
  warn: (event, fields = {}) => write(process.stderr, "warn", event, fields),
  error: (event, fields = {}) => write(process.stderr, "error", event, fields),
};
