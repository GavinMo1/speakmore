import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { openHistory } from "../../src/history.mjs";
import { resolvePaths } from "../../src/paths.mjs";

const BIN = resolve(import.meta.dirname, "..", "..", "bin", "speakmore.mjs");

test("输出接到 head 这类只读开头就关掉的程序上：安静地结束，不甩一屏报错", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // 历史要多到一次写不完：管道那头关掉时这边还在写
  const history = openHistory(resolvePaths({ SPEAKMORE_HOME: dir }).historyDb);
  for (let index = 0; index < 400; index++) {
    history.add({
      id: `id-${index}`,
      status: "completed",
      refinedText: "一句不短的话。".repeat(60),
      error: null,
      duration: 3,
      audioLocalPath: null,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    });
  }
  history.close();

  const result = spawnSync(
    "/bin/bash",
    ["-c", 'set -o pipefail; "$0" "$1" history -n 400 --json | head -c 10 >/dev/null', process.execPath, BIN],
    { encoding: "utf8", env: { ...process.env, SPEAKMORE_HOME: dir } },
  );
  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
});
