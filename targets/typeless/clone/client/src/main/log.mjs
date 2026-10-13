// 每条日志一行 JSON，和服务端的格式一样：时间、级别、事件名，加上当时的上下文。

function write(stream, level, event, fields) {
  stream.write(`${JSON.stringify({ t: new Date().toISOString(), level, event, ...fields })}\n`);
}

export const log = {
  info: (event, fields = {}) => write(process.stdout, "info", event, fields),
  warn: (event, fields = {}) => write(process.stderr, "warn", event, fields),
  error: (event, fields = {}) => write(process.stderr, "error", event, fields),
};
