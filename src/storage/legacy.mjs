import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { NotRunningError, requestControl } from "../control.mjs";
import { LocalizedError, msg } from "../i18n/index.mjs";
import { ensureHome, keyFile, legacyDataDir, oldAppKeyFile } from "./paths.mjs";

// 0.1 版把数据放在 ~/Library/Application Support/SpeakMore。那里还有东西的话，第一次运行时搬进现在的家目录。
// 想退回 0.1：把这几样搬回原处即可。历史里的录音只按文件名认（history.mjs），不用跟着改。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 旧目录里属于我们的那几样，以及各自现在该在哪。其余的是运行环境的缓存，不搬 */
const moves = (paths) => [
  ["history.db", paths.historyDb],
  ["Recordings", paths.recordingsDir],
  ["settings.json", paths.settingsFile],
  // 0.1 版只有 Gemini
  ["gemini-key.bin", keyFile(paths, "gemini")],
  // 装成应用的那份照旧名字搬，之后由 app-keys.mjs 并进共用的文件
  ["gemini-key.app.bin", oldAppKeyFile(paths, "gemini")],
];

/**
 * 搬一样东西：同一块盘上改名；家目录装在别的盘上时改名做不到（EXDEV），拷过去再删掉原来的。
 * 拷到一半出错就删掉拷了一半的，原来的不动
 */
export function moveItem(from, to, rename = renameSync) {
  try {
    rename(from, to);
    return;
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
  }
  // 那边已经有的不碰（下面拷坏了要删的只能是这里拷过去的）
  if (existsSync(to)) throw Object.assign(new Error(`${to} already exists`), { code: "EEXIST" });
  try {
    cpSync(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  } catch (error) {
    rmSync(to, { recursive: true, force: true });
    throw error;
  }
  rmSync(from, { recursive: true, force: true });
}

/** 旧版本的后台应用还在不在：它在旧目录里听着同一种控制通道 */
async function isRunning(socket) {
  try {
    await requestControl(socket, "status", {}, { timeoutMs: 1_000 });
  } catch (error) {
    if (error instanceof NotRunningError) return false;
  }
  // 答了话，或者占着不答，都算在
  return true;
}

/** 请旧版本的后台应用退出。@returns {Promise<boolean>} 限时内它退了没有 */
async function quitOldDaemon(socket, timeoutMs) {
  if (!(await isRunning(socket))) return true;
  // 它不认这条命令、或者正好在退出，都由下面的等待来判断结果
  await requestControl(socket, "quit", {}, { timeoutMs: 1_000 }).catch(() => {});
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(100)) {
    if (!(await isRunning(socket))) return true;
  }
  return false;
}

/**
 * @param {object} options
 * @param {ReturnType<import("./paths.mjs").resolvePaths>} options.paths
 * @param {string | null} [options.legacyDir] 不给是 legacyDataDir()；是 null（不是 macOS）时什么都不做
 * @param {{ info: Function, warn: Function }} options.log
 * @param {number} [options.quitTimeoutMs] 等旧版本的后台应用退出，最多等多久
 * @returns {Promise<string[]>} 搬了哪几样；没有旧目录时是空的
 */
export async function migrateLegacyData({ paths, legacyDir = legacyDataDir(), log, quitTimeoutMs = 5_000 }) {
  if (legacyDir === null || !existsSync(legacyDir)) return [];
  // 它还开着那个库的话不能搬：搬走之后它会接着往旧位置写，两边各有一半
  if (!(await quitOldDaemon(join(legacyDir, "control.sock"), quitTimeoutMs))) {
    throw new LocalizedError(msg("storage.legacyRunning"));
  }

  ensureHome(paths);
  const moved = [];
  const kept = [];
  for (const [name, to] of moves(paths)) {
    const from = join(legacyDir, name);
    if (!existsSync(from)) continue;
    // 新目录里已经有的不覆盖：那是这一版用出来的
    if (existsSync(to)) {
      kept.push(name);
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    moveItem(from, to);
    moved.push(name);
  }

  if (kept.length > 0) {
    log.warn("legacy_data_kept", { from: legacyDir, kept });
  } else {
    // 剩下的只有运行环境的缓存和旧日志：整个删掉，不留一个没人管的目录
    rmSync(legacyDir, { recursive: true, force: true });
  }
  if (moved.length > 0) log.info("legacy_data_migrated", { from: legacyDir, to: paths.home, moved });
  return moved;
}
