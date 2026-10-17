import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lastLines, tailFile } from "../../src/cli/tail.mjs";

test("最后几行：末尾的换行不算一行；不到那么多行就是全部", () => {
  assert.equal(lastLines("a\nb\nc\n", 2), "b\nc");
  assert.equal(lastLines("a\nb", 5), "a\nb");
  assert.equal(lastLines("", 3), "");
});

test("不跟着时打完最后几行就回来", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-tail-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "main.log");
  writeFileSync(file, "一\n二\n三\n");
  const written = [];
  assert.equal(await tailFile(file, { lines: 2, follow: false, write: (text) => written.push(text) }), 0);
  assert.deepEqual(written, ["二\n三\n"]);
});

test("-f：接着把新写进来的打出来；日志被轮换（变小）时从头读新的那一份", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-tail-"));
  const file = join(dir, "main.log");
  writeFileSync(file, "旧的\n");
  const written = [];
  const done = tailFile(file, { lines: 1, follow: true, write: (text) => written.push(text), intervalMs: 20 });
  t.after(() => {
    process.emit("SIGINT");
    rmSync(dir, { recursive: true, force: true });
  });
  const until = async (check) => {
    for (let waited = 0; !check() && waited < 3000; waited += 20) await new Promise((r) => setTimeout(r, 20));
  };
  appendFileSync(file, "新写的一行\n");
  await until(() => written.includes("新写的一行\n"));
  assert.ok(written.includes("新写的一行\n"), JSON.stringify(written));
  writeFileSync(file, "轮换后\n");
  await until(() => written.includes("轮换后\n"));
  assert.ok(written.includes("轮换后\n"), JSON.stringify(written));
  process.emit("SIGINT");
  assert.equal(await done, 0);
});
