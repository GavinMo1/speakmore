import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { msg } from "../../i18n/index.mjs";
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
  noPositionals(positionals, "uninstall");
  const { paths, t } = io;
  const keepData = values["keep-data"];
  const named = { home: paths.home, yours: t("cli.uninstall.yours") };

  if (!values.yes) {
    if (!io.interactive) throw new UsageError(msg("cli.uninstall.needsConfirm"));
    io.out(t(keepData ? "cli.uninstall.planKeep" : "cli.uninstall.planAll", named));
    if (!(await io.confirm(t("cli.uninstall.confirm")))) {
      io.out(t("cli.uninstall.aborted"));
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
    const logsDir = dirname(paths.logFile);
    for (const dir of [paths.binDir, paths.appDir, paths.runtimeDir, paths.runDir, logsDir, paths.cacheDir]) {
      rmSync(dir, { recursive: true, force: true });
    }
    removed.push(t("cli.uninstall.removedKeep", named));
  } else {
    try {
      if (io.removeKeychainKey()) removed.push(t("cli.uninstall.keychainItem"));
    } catch (error) {
      leftovers.push(t("cli.uninstall.keychainFailed", { reason: error.message }));
    }
    rmSync(paths.home, { recursive: true, force: true });
    removed.push(t("cli.uninstall.removedAll", named));
  }

  io.out(t("cli.uninstall.done"));
  for (const item of removed) io.out(`  ${t("cli.uninstall.removed", { item })}`);
  if (keepData) io.out(`  ${t("cli.uninstall.kept", named)}`);
  // 删不了、或者不该由我们删的，照实列出来
  leftovers.push(t("cli.uninstall.permissions"));
  if (existsSync(io.sharedPreferencesFile)) {
    leftovers.push(t("cli.uninstall.sharedPrefs", { file: io.sharedPreferencesFile }));
  }
  // 从源码目录运行的那种，程序不在我们的目录里
  if (!io.packageDir.startsWith(paths.home + sep)) leftovers.push(t("cli.uninstall.sourceDir", { dir: io.packageDir }));
  io.out(`  ${t("cli.uninstall.leftovers")}`);
  for (const item of leftovers) io.out(`    · ${item}`);
  return 0;
}
