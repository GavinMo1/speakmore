#!/usr/bin/env node
// 端到端测试：真的 Electron、真的录音编码、真的服务端和模型，只有两头是假的——
// 麦克风换成一个 WAV 文件，贴字换成"记下来"。不会碰真实的键盘、剪贴板和历史记录。
//
// 用法：环境里要有所选那一家的 key（后台应用用它起内置的服务）。默认用 Gemini，SPEAKMORE_MODEL 可以换：
//   scripts/dev/with-key.sh gemini node scripts/dev/e2e.mjs <一段 16 位 PCM 的 WAV>
//   SPEAKMORE_MODEL=openai scripts/dev/with-key.sh openai node scripts/dev/e2e.mjs <一段 16 位 PCM 的 WAV>
// 录音时长默认 7.5 秒（跨过两个 3 秒的分块边界），可用 SPEAKMORE_E2E_RECORD_MS 改。
// 本地转写那条（local 模式）：数据目录是新的，本地模型会真从下载源下一遍（SPEAKMORE_MODEL_SOURCE 可以换），装好才开始录：
//   SPEAKMORE_MODE=local scripts/dev/with-key.sh deepseek node scripts/dev/e2e.mjs <WAV>
// 想用打包时摆出来的那一份跑（只带运行时依赖，看漏没漏包）：SPEAKMORE_E2E_APP=<摆好的目录>

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const wav = process.argv[2] && resolve(process.argv[2]);
if (!wav || !existsSync(wav)) {
  console.error("用法：node scripts/dev/e2e.mjs <一段 16 位 PCM 的 WAV>");
  process.exit(2);
}

const electron = createRequire(import.meta.url)("electron");
// 名字起得短：家目录里要放控制通道的套接字，路径有长度上限
const workDir = mkdtempSync(join(tmpdir(), "sm-e2e-"));
const outPath = join(workDir, "result.json");

const child = spawn(
  electron,
  [
    ".",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    // %noloop：文件放完就静音，不从头再放
    `--use-file-for-fake-audio-capture=${wav}%noloop`,
    // 音频服务默认在沙箱里，读不到这个 WAV。只在测试里放开这一个服务的沙箱
    "--disable-features=AudioServiceSandbox",
  ],
  {
    cwd: process.env.SPEAKMORE_E2E_APP ?? resolve(import.meta.dirname, "../.."),
    env: { ...process.env, SPEAKMORE_E2E_OUT: outPath, SPEAKMORE_HOME: join(workDir, "home") },
    stdio: ["ignore", "inherit", "inherit"],
  },
);

// Electron 万一卡住（比如启动就出错），到时间强制结束，测试算失败而不是一直挂着。
// local 模式另给下载和装载模型的时间
const recordMs = Number(process.env.SPEAKMORE_E2E_RECORD_MS ?? 7_500);
const setupMs = process.env.SPEAKMORE_MODE === "local" ? 20 * 60_000 : 0;
const watchdog = setTimeout(() => child.kill("SIGKILL"), setupMs + recordMs + 60_000);

child.on("exit", (code) => {
  clearTimeout(watchdog);
  const problems = [];
  let result = null;
  if (!existsSync(outPath)) {
    problems.push(`Electron 以 ${code} 退出，没有留下结果文件`);
  } else {
    result = JSON.parse(readFileSync(outPath, "utf8"));
    if (result.failed) problems.push(`听写失败：${result.failed}`);
    if (!result.delivered) problems.push("没有拿到成品文字");
    if (result.pasted.length !== 1 || result.pasted[0] !== result.delivered) problems.push("贴出去的文字和成品不一致");
    const [row] = result.history;
    if (result.history.length !== 1 || row?.status !== "completed" || row?.refinedText !== result.delivered) {
      problems.push("历史里应该正好有一条完成的记录，内容等于成品");
    } else if (!existsSync(row.audioLocalPath) || statSync(row.audioLocalPath).size === 0) {
      problems.push("录音文件没有存下来");
    } else {
      console.log(`录音 ${row.duration.toFixed(1)} 秒，文件 ${statSync(row.audioLocalPath).size} 字节`);
    }
    // 记账：这一次听写调模型的账对得上这条历史
    const { usage } = row ?? {};
    if (!usage || usage.calls < 1 || !(usage.inputTokens > 0) || !(usage.latencyMs > 0)) {
      problems.push(`这条历史没有对上账：${JSON.stringify(usage)}`);
    } else {
      const cost = usage.costUsd === null ? "价格不明" : `$${usage.costUsd.toPrecision(2)}`;
      console.log(
        `调了 ${usage.calls} 次模型：输入 ${usage.inputTokens} token、输出 ${usage.outputTokens} token，${cost}，模型 ${usage.latencyMs} 毫秒`,
      );
    }
  }
  if (result?.localModel) {
    const { downloadMs, loadMs, backend } = result.localModel;
    console.log(`本地模型：下载 ${(downloadMs / 1000).toFixed(1)} 秒，装载 ${loadMs} 毫秒，跑在 ${backend}`);
  }
  if (result?.delivered) console.log(`成品：${result.delivered}`);
  rmSync(workDir, { recursive: true, force: true });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✖ ${problem}`);
    process.exit(1);
  }
  console.log("✔ 录音、分块上传、整理、贴字、存历史、记账都走通了");
});
