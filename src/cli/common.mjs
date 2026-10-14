import { parseArgs } from "node:util";
import { resolveSettings } from "../storage/settings.mjs";
import { renderStatus } from "./render/status.mjs";

// 各个子命令共用的：参数解析、两种"用错了"的错误、读设置和统计、确保后台应用在运行。

/** 命令敲错了：以 2 退出，并提示去看 help */
export class UsageError extends Error {}

/** 设置写错了：以 2 退出 */
export class ConfigError extends Error {}

export function parse(args, options = {}) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(`参数不对：${error.message}`);
  }
}

export function noPositionals(positionals, usage) {
  if (positionals.length > 0) throw new UsageError(`多了参数 ${positionals.join(" ")}。用法：${usage}`);
}

export function positiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new UsageError(`${flag} 后面要跟一个正整数`);
  return number;
}

export function currentSettings(io) {
  try {
    return resolveSettings({ file: io.paths.settingsFile, env: io.env });
  } catch (error) {
    throw new ConfigError(error.message);
  }
}

/** 今天和累计的统计。一次都没用过（库还不存在）时两项都是 null */
export function readStats(io) {
  const history = io.openHistory(io.paths.historyDb, { readOnly: true });
  if (history === null) return { today: null, total: null };
  try {
    const midnight = io.now();
    midnight.setHours(0, 0, 0, 0);
    return { today: history.stats({ since: midnight.toISOString() }), total: history.stats() };
  } finally {
    history.close();
  }
}

export const renderOptions = (io) => ({
  color: io.color,
  truecolor: io.truecolor,
  now: io.now(),
  timeZone: io.timeZone,
});

export function showStatus(io, status, settings) {
  io.out(renderStatus({ status, version: io.version, settings, stats: readStats(io) }, renderOptions(io)));
}

export function permissionMissing({ permissions }) {
  return permissions.microphone !== "granted" || permissions.listen === false || permissions.trusted === false;
}

export async function ensureRunning(io) {
  const status = await io.daemon.status();
  if (status !== null) return status;
  io.out("正在启动 SpeakMore…");
  return io.daemon.start({ onProgress: io.out });
}

export const PACKAGED_NOTE = "现在运行的是装在“应用程序”里的 SpeakMore.app。";

export const PACKAGED_RELAUNCH = "在菜单栏点“听写”→“退出”，再打开一次 SpeakMore.app";
