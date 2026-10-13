import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// 历史记录。表结构取原版 history_v2 里听写用得到的那几列（docs/08-local-data.md），
// 列名保持一致。用 Node 自带的 SQLite，不用原版的 better-sqlite3：少一个要随 Electron 重新编译的原生模块。

/** 表结构的版本号，存在 PRAGMA user_version 里。以后改表时在 MIGRATIONS 末尾加一步，不改已有的 */
const MIGRATIONS = [
  `CREATE TABLE history (
     id               TEXT PRIMARY KEY,   -- audio_id
     status           TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
     refined_text     TEXT NOT NULL,      -- 失败时是空字符串
     error            TEXT,               -- 失败原因，成功时为空
     duration         REAL NOT NULL,      -- 录音时长，秒
     audio_local_path TEXT,               -- 录音文件；失败的记录留着它，话不会白说
     created_at       TEXT NOT NULL       -- ISO 8601
   );
   CREATE INDEX history_created_at ON history (created_at DESC);`,
];

function migrate(db) {
  const { user_version: current } = db.prepare("PRAGMA user_version").get();
  if (current > MIGRATIONS.length) {
    throw new Error(`历史库的版本是 ${current}，比这个程序认识的 ${MIGRATIONS.length} 新，不敢动它`);
  }
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

/** 打开（没有就新建）历史库 */
export function openHistory(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  migrate(db);

  const insert = db.prepare(
    `INSERT INTO history (id, status, refined_text, error, duration, audio_local_path, created_at)
     VALUES (:id, :status, :refinedText, :error, :duration, :audioLocalPath, :createdAt)`,
  );
  const select = db.prepare(
    `SELECT id, status, refined_text AS refinedText, error, duration,
            audio_local_path AS audioLocalPath, created_at AS createdAt
     FROM history ORDER BY created_at DESC LIMIT :limit`,
  );

  return {
    /** @param {{ id: string, status: "completed" | "failed", refinedText: string, error: string | null, duration: number, audioLocalPath: string | null, createdAt: string }} entry */
    add(entry) {
      insert.run(entry);
    },
    /** 最近的记录，新的在前 */
    list({ limit = 200 } = {}) {
      return select.all({ limit }).map((row) => ({ ...row }));
    },
    close() {
      db.close();
    },
  };
}
