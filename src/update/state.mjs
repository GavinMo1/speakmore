import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { LocalizedError, msg } from "../i18n/index.mjs";

// 家目录 run/ 里命令行和 App 共用的三样（路径见 storage/paths.mjs）。谁查的、谁更新的都写这里，两边照同一份显示：
//   update-check.json  上一次问下载地址：{ checkedAt, latest }。latest 是那时知道的最新版本，这次没问到时沿用之前知道的
//                      （0.10.0 及以前的命令行也读它，只认这两项）
//   update.json        正在进行的、或者上一次的更新：{ state: running | done | failed, phase, version, from, by, pid,
//                      startedAt, finishedAt, problem, shown }
//   update.lock        更新时拿着的锁，里面是进程号：命令行和 App 不能同时换程序

/** 读一个 JSON 小文件。没有、写到一半读到的（解析不了）都当没有：下一次读到的就是完整的 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

/** 上一次问下载地址的结果；没问过、记录坏了都是 null */
export function readCheck(paths) {
  const record = readJson(paths.updateCheckFile);
  return Number.isFinite(Date.parse(record?.checkedAt)) ? record : null;
}

export function writeCheck(paths, record) {
  writeJson(paths.updateCheckFile, record);
}

/** 正在进行的、或者上一次的更新（原样）；没有是 null */
export function readProgress(paths) {
  const record = readJson(paths.updateFile);
  return typeof record?.state === "string" ? record : null;
}

export function writeProgress(paths, record) {
  writeJson(paths.updateFile, record);
}

/** 一次更新最多做多久。拿锁超过这么久的当没人拿着（和 index.mjs 里算中断的时限一样） */
const LOCK_AT_MOST_MS = 2 * 60 * 60 * 1000;

/** 这个进程还在不在。在、只是不归我们管（EPERM）也算在 */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * 拿更新的锁。别的进程拿着、而且它还在：抛出说正在更新；拿着的进程已经不在了（被强行结束、断电）：当没人拿着。
 * @returns {() => void} 放掉锁
 */
export function acquireLock(paths, { pid = process.pid, alive = isAlive } = {}) {
  mkdirSync(dirname(paths.updateLock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      // wx：文件已经在就失败，两个进程同时来只有一个拿得到
      fd = openSync(paths.updateLock, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const text = readFileSync(paths.updateLock, "utf8").trim();
      const holder = /^\d+$/.test(text) ? Number(text) : Number.NaN;
      const age = Date.now() - statSync(paths.updateLock).mtimeMs;
      // 还没写进进程号的：别人刚建好、正要写。刚建的几秒内算有人拿着
      const fresh = !Number.isInteger(holder) && age < 10_000;
      // 拿了两小时还没放的：那个进程早就没了，进程号被别的程序用上了（Windows 上常见），不算
      const held = Number.isInteger(holder) && holder > 0 && holder !== pid && alive(holder) && age < LOCK_AT_MOST_MS;
      if (fresh || held) {
        throw new LocalizedError(msg("update.busy", { pid: Number.isInteger(holder) ? holder : "?" }));
      }
      rmSync(paths.updateLock, { force: true });
      continue;
    }
    writeSync(fd, String(pid));
    closeSync(fd);
    return () => {
      // 只放自己的：万一锁已经被当成没人拿着、换成了别人的，不动它
      try {
        if (readFileSync(paths.updateLock, "utf8").trim() === String(pid)) rmSync(paths.updateLock, { force: true });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    };
  }
  throw new LocalizedError(msg("update.busy", { pid: "?" }));
}
