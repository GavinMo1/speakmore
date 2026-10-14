import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { openHistory } from "../../src/storage/history.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "speakmore-history-"));
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

test("统计：只数完成的听写，可以只看某个时刻之后的", () => {
  const history = openHistory(join(dir, "history.db"));
  history.add(entry({ id: "a", createdAt: "2026-10-12T08:00:00.000Z", refinedText: "昨天说的话", duration: 6 }));
  history.add(entry({ id: "b", createdAt: "2026-10-13T08:00:00.000Z", refinedText: "今天第一句", duration: 4 }));
  history.add(entry({ id: "c", createdAt: "2026-10-13T09:00:00.000Z", refinedText: "今天第二句话", duration: 5.5 }));
  history.add(
    entry({
      id: "d",
      createdAt: "2026-10-13T10:00:00.000Z",
      status: "failed",
      refinedText: "",
      error: "连不上",
      duration: 9,
    }),
  );

  assert.deepEqual(history.stats(), { dictations: 3, characters: 16, seconds: 15.5, failed: 1 });
  assert.deepEqual(history.stats({ since: "2026-10-13T00:00:00.000Z" }), {
    dictations: 2,
    characters: 11,
    seconds: 9.5,
    failed: 1,
  });
  history.close();
});

test("空的历史库统计出来全是 0", () => {
  const history = openHistory(join(dir, "history.db"));
  assert.deepEqual(history.stats(), { dictations: 0, characters: 0, seconds: 0, failed: 0 });
  history.close();
});

test("只读打开：能看不能写，库不存在时不会凭空建一个", () => {
  const dbPath = join(dir, "history.db");
  assert.equal(openHistory(dbPath, { readOnly: true }), null);
  assert.equal(existsSync(dbPath), false);

  const writable = openHistory(dbPath);
  writable.add(entry());
  writable.close();

  const readOnly = openHistory(dbPath, { readOnly: true });
  assert.equal(readOnly.list().length, 1);
  assert.throws(() => readOnly.add(entry({ id: "b" })), /readonly/);
  readOnly.close();
});

test("只读打开时发现库的版本和程序对不上，就不读", () => {
  const dbPath = join(dir, "history.db");
  openHistory(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA user_version = 99");
  db.close();
  assert.throws(() => openHistory(dbPath, { readOnly: true }), /版本/);
});
