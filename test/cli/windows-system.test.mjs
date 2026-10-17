import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const windowsOnly = { skip: process.platform !== "win32" && "要在 Windows 上起 PowerShell" };

test("退出后再删：叫它的进程马上就退出，那几个目录照样在它退出之后删掉", windowsOnly, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-winsys-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const doomed = join(dir, "runtime.old.test");
  mkdirSync(doomed);
  writeFileSync(join(doomed, "electron.exe"), "");
  // 和 speakmore uninstall、update 一样：交代完马上退出。Node 在 Windows 上会把直接起的子进程跟着自己一起收掉
  const script = join(dir, "caller.mjs");
  const module = pathToFileURL(join(import.meta.dirname, "../../src/cli/windows-system.mjs")).href;
  writeFileSync(
    script,
    `import { removeAfterExit } from ${JSON.stringify(module)};\nremoveAfterExit([process.argv[2]]);\n`,
  );
  execFileSync(process.execPath, [script, doomed]);
  // 起两次 PowerShell 加上等的那一下，真机上两秒左右；整个文件只有 5 秒（--test-timeout）
  for (let waited = 0; existsSync(doomed) && waited < 4000; waited += 100) await delay(100);
  assert.equal(existsSync(doomed), false, "叫它的进程退出 4 秒后目录还在");
});
