#!/usr/bin/env node
// speakmore 命令的入口。这里只做两件必须抢在加载其余代码之前的事，命令本身在 src/cli/main.mjs。

if (process.platform !== "darwin") {
  console.error("SpeakMore 目前只支持 macOS：听热键和贴字靠的是 macOS 的系统接口。");
  process.exit(1);
}
const [major, minor] = process.versions.node.split(".").map(Number);
// 22.13 起自带的 SQLite 才不用额外加启动参数（22.12 上实测会报"没有 node:sqlite 这个模块"）
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`SpeakMore 需要 Node 22.13 或更新的版本，现在是 ${process.versions.node}。`);
  process.exit(1);
}

// 历史库用的是 Node 自带的 SQLite。在 Node 22 和 24 里它还标着"实验性"，每跑一次命令都会往终端上
// 打一句警告。只滤掉这一句，别的警告照常显示
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning?.message ?? warning).includes("SQLite")) return;
  emitWarning.call(process, warning, ...rest);
};

const { main } = await import("../src/cli/main.mjs");
process.exitCode = await main(process.argv.slice(2));
