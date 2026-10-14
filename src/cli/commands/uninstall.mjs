import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { noPositionals, parse, UsageError } from "../common.mjs";

// speakmore uninstall：停掉后台，把 SpeakMore 的目录整个删掉；目录以外删不了的照实列出来。

/** 这个链接是不是指向我们自己的那条命令。清单里记的东西卸载前要再认一遍：那个位置上可能已经换成了别的 */
function isOurLink(link, binDir) {
  try {
    if (!lstatSync(link).isSymbolicLink()) return false;
    return resolve(dirname(link), readlinkSync(link)).startsWith(binDir + sep);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function recordedLinks(io) {
  try {
    return readFileSync(io.paths.linksFile, "utf8").split("\n").filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function uninstall(args, io) {
  const { values, positionals } = parse(args, {
    "keep-data": { type: "boolean", default: false },
    yes: { type: "boolean", short: "y", default: false },
  });
  noPositionals(positionals, "speakmore uninstall [--keep-data] [--yes]");
  const { paths } = io;
  const keepData = values["keep-data"];
  const yours = "设置、key、历史和录音";

  if (!values.yes) {
    if (!io.interactive) throw new UsageError("卸载要先确认。不在终端里运行时加上 --yes。");
    io.out(
      keepData
        ? `要卸载 SpeakMore：删掉 ${paths.home} 里的程序和运行环境，${yours}留着。`
        : `要卸载 SpeakMore：把 ${paths.home} 整个删掉，包括程序、运行环境，以及你的${yours}。删了找不回来。`,
    );
    if (!(await io.confirm("确定吗？输入 y 再按回车："))) {
      io.out("没有动。");
      return 1;
    }
  }

  // 它还开着那些文件。停不掉就不往下删，错误照直报出去
  await io.daemon.stop();

  const removed = [];
  const leftovers = [];
  for (const link of recordedLinks(io)) {
    if (!isOurLink(link, paths.binDir)) continue;
    rmSync(link);
    removed.push(link);
  }

  if (keepData) {
    const runDir = dirname(paths.controlSocket);
    const logsDir = dirname(paths.logFile);
    for (const dir of [paths.binDir, paths.appDir, paths.runtimeDir, runDir, logsDir, paths.cacheDir]) {
      rmSync(dir, { recursive: true, force: true });
    }
    removed.push(`${paths.home} 里的程序、运行环境、日志和缓存`);
  } else {
    try {
      if (io.removeKeychainKey()) removed.push("钥匙串里用来加密 key 的那一条");
    } catch (error) {
      leftovers.push(
        `钥匙串里用来加密 key 的那一条没删掉（${error.message}）：可以在“钥匙串访问”里搜 SpeakMore 手动删`,
      );
    }
    rmSync(paths.home, { recursive: true, force: true });
    removed.push(`${paths.home}（程序、运行环境，以及你的${yours}）`);
  }

  io.out("SpeakMore 已经卸载。");
  for (const item of removed) io.out(`  删掉了：${item}`);
  if (keepData) io.out(`  留着：${paths.home} 里的${yours}。重新安装之后接着用；不要了就把这个目录删掉`);
  // 删不了、或者不该由我们删的，照实列出来
  leftovers.push(
    "给终端的麦克风、输入监控、辅助功能权限没有动：它们记在终端名下，在“系统设置 → 隐私与安全性”里可以关掉",
  );
  if (existsSync(io.sharedPreferencesFile)) {
    leftovers.push(
      `${io.sharedPreferencesFile} 没有动：运行环境记窗口大小之类的一个小文件，所有用原版 Electron 的程序共用`,
    );
  }
  // 从源码目录运行的那种，程序不在我们的目录里
  if (!io.packageDir.startsWith(paths.home + sep)) leftovers.push(`源码目录没有动：${io.packageDir}`);
  io.out("  还留在系统里的：");
  for (const item of leftovers) io.out(`    · ${item}`);
  return 0;
}
