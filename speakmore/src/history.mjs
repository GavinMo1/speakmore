import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// 历史记录。表结构取原版 history_v2 里听写用得到的那几列（docs/08-local-data.md），
// 列名保持一致。用 Node 自带的 SQLite，不用原版的 better-sqlite3：少一个要随 Electron 重新编译的原生模块。
// 后台应用负责写，命令行只读着看，两边用的是这同一份代码。

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

/** 只读着看的那一方不能替库升级，版本对不上时列可能不一样，所以不读 */
function openReadOnly(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const { user_version: version } = db.prepare("PRAGMA user_version").get();
  if (version !== MIGRATIONS.length) {
    db.close();
    throw new Error(
      `历史库的版本是 ${version}，这个程序认识的是 ${MIGRATIONS.length}：先把 SpeakMore 启动一次，或者更新到新版`,
    );
  }
  return db;
}

/**
 * 打开历史库。默认没有就新建，并把表结构升到最新。
 * @param {string} dbPath
 * @param {{ readOnly?: boolean }} [options] 只读时不新建也不升级；库还不存在就返回 null
 */
export function openHistory(dbPath, { readOnly = false } = {}) {
  let db;
  if (readOnly) {
    if (!existsSync(dbPath)) return null;
    db = openReadOnly(dbPath);
  } else {
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    migrate(db);
  }
  // 另一个进程正好在写的时候等一下，不立刻报"库被锁住"
  db.exec("PRAGMA busy_timeout = 2000");

  const insert = db.prepare(
    `INSERT INTO history (id, status, refined_text, error, duration, audio_local_path, created_at)
     VALUES (:id, :status, :refinedText, :error, :duration, :audioLocalPath, :createdAt)`,
  );
  const select = db.prepare(
    `SELECT id, status, refined_text AS refinedText, error, duration,
            audio_local_path AS audioLocalPath, created_at AS createdAt
     FROM history ORDER BY created_at DESC LIMIT :limit`,
  );
  const summarize = db.prepare(
    `SELECT count(*) FILTER (WHERE status = 'completed') AS dictations,
            coalesce(sum(length(refined_text)) FILTER (WHERE status = 'completed'), 0) AS characters,
            coalesce(sum(duration) FILTER (WHERE status = 'completed'), 0) AS seconds,
            count(*) FILTER (WHERE status = 'failed') AS failed
     FROM history WHERE created_at >= :since`,
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
    /**
     * 说了多少次、多少字、多长时间（只数完成的），以及失败了几次。
     * @param {{ since?: string }} [range] 只数这个时刻（ISO 8601）之后的
     */
    stats({ since = "" } = {}) {
      return { ...summarize.get({ since }) };
    },
    close() {
      db.close();
    },
  };
}
