import { existsSync } from "node:fs";
import { noPositionals, parse, positiveInteger } from "../common.mjs";

// speakmore logs：看后台应用的日志。

const DEFAULT_LOG_LINES = 40;

export async function logs(args, io) {
  const { values, positionals } = parse(args, {
    lines: { type: "string", short: "n", default: String(DEFAULT_LOG_LINES) },
    follow: { type: "boolean", short: "f", default: false },
  });
  noPositionals(positionals, "speakmore logs [-n 行数] [-f]");
  const lines = positiveInteger(values.lines, "-n");
  if (!existsSync(io.paths.logFile)) {
    io.out(`还没有日志：SpeakMore 启动过之后会写到 ${io.paths.logFile}`);
    return 0;
  }
  return io.tail(["-n", String(lines), ...(values.follow ? ["-f"] : []), io.paths.logFile]);
}
