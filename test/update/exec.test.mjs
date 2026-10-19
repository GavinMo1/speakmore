import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

// 跑安装脚本、启动命令的那一层（src/update/exec.mjs）

const execModule = new URL("../../src/update/exec.mjs", import.meta.url).href;

test("forward：子进程说的话经管道转到这个进程的标准输出、标准错误上（App 起的更新进程靠它把话写进日志）", () => {
  const script = `
    import { runToEnd } from ${JSON.stringify(execModule)};
    const child = "console.log('到标准输出'); console.error('到标准错误'); process.exit(3)";
    const code = await runToEnd(process.execPath, ["-e", child], { env: process.env, stdio: "forward" });
    console.log("exit=" + code);
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(out, /到标准输出/);
  assert.match(out, /exit=3/);
});
