import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NotRunningError, requestControl } from "../control.mjs";
import { ensureHome, legacyDataDir } from "./paths.mjs";

// 0.1 版把数据放在 ~/Library/Application Support/SpeakMore。那里还有东西的话，第一次运行时搬进现在的家目录。
// 想退回 0.1：把这几样搬回原处即可（历史里记的录音位置会指着新地方，只影响"录音留在哪"那句话）。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 旧目录里属于我们的那几样，以及各自现在该在哪。其余的是运行环境的缓存，不搬 */
const moves = (paths) => [
  ["history.db", paths.historyDb],
  ["Recordings", paths.recordingsDir],
  ["settings.json", paths.settingsFile],
  ["gemini-key.bin", paths.keyFile],
  ["gemini-key.app.bin", paths.appKeyFile],
];

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

/** 历史里记的是录音的绝对路径，录音搬了家，这些路径跟着改 */
function repointRecordings(historyDb, from, to) {
  const db = new DatabaseSync(historyDb);
  try {
    db.prepare(
      `UPDATE history SET audio_local_path = :to || substr(audio_local_path, length(:from) + 1)
       WHERE substr(audio_local_path, 1, length(:from)) = :from`,
    ).run({ from: `${from}/`, to: `${to}/` });
  } finally {
    db.close();
  }
}

/**
 * @param {object} options
 * @param {ReturnType<import("./paths.mjs").resolvePaths>} options.paths
 * @param {string} [options.legacyDir]
 * @param {{ info: Function, warn: Function }} options.log
 * @param {number} [options.quitTimeoutMs] 等旧版本的后台应用退出，最多等多久
 * @returns {Promise<string[]>} 搬了哪几样；没有旧目录时是空的
 */
export async function migrateLegacyData({ paths, legacyDir = legacyDataDir(), log, quitTimeoutMs = 5_000 }) {
  if (!existsSync(legacyDir)) return [];
  // 它还开着那个库的话不能搬：搬走之后它会接着往旧位置写，两边各有一半
  if (!(await quitOldDaemon(join(legacyDir, "control.sock"), quitTimeoutMs))) {
    throw new Error("旧版本的 SpeakMore 还在运行，数据搬不过来。先把它退出（菜单栏“听写”→“退出”），再运行一次。");
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
    renameSync(from, to);
    moved.push(name);
  }
  if (moved.includes("history.db")) {
    repointRecordings(paths.historyDb, join(legacyDir, "Recordings"), paths.recordingsDir);
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
