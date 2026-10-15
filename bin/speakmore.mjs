#!/usr/bin/env node
// speakmore 命令的入口。这里只做几件必须抢在加载其余代码之前的事，命令本身在 src/cli/main.mjs。
import { nodeVersionProblem } from "../src/cli/node-version.mjs";
import { createTranslator, localesFromEnv, resolveLocale, SYSTEM_LOCALE } from "../src/i18n/index.mjs";

// 这两句说在读设置之前，按终端的语言说
const t = createTranslator(resolveLocale(SYSTEM_LOCALE, localesFromEnv(process.env)));
if (process.platform !== "darwin") {
  console.error(t("cli.macOnly"));
  process.exit(1);
}
const versionProblem = nodeVersionProblem(process.versions.node);
if (versionProblem) {
  console.error(t.text(versionProblem));
  process.exit(1);
}

// 历史库用的是 Node 自带的 SQLite。在 Node 22 和 24 里它还标着"实验性"，每跑一次命令都会往终端上
// 打一句警告。只滤掉这一句，别的警告照常显示
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning?.message ?? warning).includes("SQLite")) return;
  emitWarning.call(process, warning, ...rest);
};

// 输出接到 head 这类程序上时，那头读够了就把管道关掉，这边再写会报 EPIPE。这是正常结束，不是出错
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

const { main } = await import("../src/cli/main.mjs");
process.exitCode = await main(process.argv.slice(2));
