import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isAlive } from "../update/state.mjs";

// 搬家的记录：家目录 run/move.json。搬的时候写在旧目录里（也是"正在搬，别在这里启动"的记号，index.mjs 的 settleMove 认它），
// 搬完写在最终在用的那个目录里（成了是新的，没成是旧的），排查时看：
//   { state: running | done | failed, by: cli | app, from, to, pid, startedAt, finishedAt, problem }
// 定位文件里的 moving（storage/location.mjs）是另一半：拷到一半断了电，下次照它认出那一份是没搬完的。

/** 一次搬家最多做多久：标着进行中、可已经过了这么久的，进程号多半被别的程序用上了 */
const MOVE_AT_MOST_MS = 6 * 60 * 60 * 1000;

export function readMoveRecord(paths) {
  try {
    const record = JSON.parse(readFileSync(paths.moveFile, "utf8"));
    return typeof record?.state === "string" ? record : null;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export function writeMoveRecord(paths, record) {
  mkdirSync(dirname(paths.moveFile), { recursive: true });
  writeFileSync(paths.moveFile, JSON.stringify(record));
}

/** 记录里的那个搬家进程还在搬 */
export function stillMoving(record, { alive = isAlive, now = () => new Date() } = {}) {
  return (
    record?.state === "running" &&
    Number.isInteger(record.pid) &&
    alive(record.pid) &&
    now() - Date.parse(record.startedAt) < MOVE_AT_MOST_MS
  );
}
