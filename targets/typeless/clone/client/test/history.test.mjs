import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { openHistory } from "../src/main/history.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "clone-history-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const entry = (overrides = {}) => ({
  id: "a1",
  status: "completed",
  refinedText: "我们后天开会。",
  error: null,
  duration: 4.2,
  audioLocalPath: "/tmp/a1.webm",
  createdAt: "2026-10-13T08:00:00.000Z",
  ...overrides,
});

test("存进去的记录能原样读出来，新的在前；目录不存在会自己建", () => {
  const history = openHistory(join(dir, "nested", "history.db"));
  history.add(entry());
  history.add(
    entry({
      id: "a2",
      status: "failed",
      refinedText: "",
      error: "服务端没有回应",
      createdAt: "2026-10-13T09:00:00.000Z",
    }),
  );
  assert.deepEqual(history.list(), [
    entry({
      id: "a2",
      status: "failed",
      refinedText: "",
      error: "服务端没有回应",
      createdAt: "2026-10-13T09:00:00.000Z",
    }),
    entry(),
  ]);
  assert.equal(history.list({ limit: 1 }).length, 1);
  history.close();
});

test("关掉再打开，记录还在，不会重复建表", () => {
  const path = join(dir, "history.db");
  const first = openHistory(path);
  first.add(entry());
  first.close();
  const second = openHistory(path);
  assert.equal(second.list().length, 1);
  second.close();
});

test("同一个录音不能存两次；状态只能是完成或失败", () => {
  const history = openHistory(join(dir, "history.db"));
  history.add(entry());
  assert.throws(() => history.add(entry()), /UNIQUE|constraint/i);
  assert.throws(() => history.add(entry({ id: "a3", status: "pending" })), /CHECK|constraint/i);
  history.close();
});

test("库的版本比程序新时拒绝打开，不去动它", () => {
  const path = join(dir, "history.db");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA user_version = 99");
  db.close();
  assert.throws(() => openHistory(path), /版本是 99/);
});
