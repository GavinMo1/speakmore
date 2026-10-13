// 每条日志一行 JSON：时间、级别、事件名，加上当时的上下文（哪次录音、几块、多少字节、耗时）。
// 错误和警告走标准错误，其余走标准输出。

function write(stream, level, event, fields) {
  stream.write(`${JSON.stringify({ t: new Date().toISOString(), level, event, ...fields })}\n`);
}

export const log = {
  info: (event, fields = {}) => write(process.stdout, "info", event, fields),
  warn: (event, fields = {}) => write(process.stderr, "warn", event, fields),
  error: (event, fields = {}) => write(process.stderr, "error", event, fields),
};
