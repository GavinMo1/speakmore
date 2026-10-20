import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

// 搬家后在 Windows 上删旧目录（src/windows-system.mjs 的 removeHomeAfterExit）。单放一个文件：要起两次 PowerShell、
// 等进程退出，一条就两秒多，和别的放在一起超过每个文件 5 秒（--test-timeout）

const windowsOnly = { skip: process.platform !== "win32" && "要在 Windows 上起 PowerShell" };

test("搬家后删旧目录：等叫它的进程退出，只删我们的；还有别人的东西就留着它们和 MOVED.json", windowsOnly, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-winsys-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const homes = { clean: join(dir, "clean"), mixed: join(dir, "mixed [1]") };
  for (const home of Object.values(homes)) {
    mkdirSync(join(home, "versions", "0.12.0"), { recursive: true });
    writeFileSync(join(home, "versions", "0.12.0", "electron.exe"), "");
    writeFileSync(join(home, "settings.json"), "{}");
    writeFileSync(join(home, "MOVED.json"), "{}");
  }
  writeFileSync(join(homes.mixed, "notes.txt"), "用户自己的");
  const script = join(dir, "caller.mjs");
  const module = pathToFileURL(join(import.meta.dirname, "../src/windows-system.mjs")).href;
  writeFileSync(
    script,
    `import { removeHomeAfterExit } from ${JSON.stringify(module)};
for (const home of process.argv.slice(2)) removeHomeAfterExit(home, ["versions", "settings.json"], [process.pid]);
`,
  );
  // 叫它的进程就在旧目录里起（开始菜单打开的 App 工作目录是家目录）：干活的 PowerShell 不能跟着占住它
  execFileSync(process.execPath, [script, homes.clean, homes.mixed], { cwd: homes.clean });
  for (let waited = 0; existsSync(homes.clean) && waited < 4000; waited += 100) await delay(100);
  assert.equal(existsSync(homes.clean), false, "只有我们的东西的旧目录 4 秒后还在");
  assert.equal(existsSync(join(homes.mixed, "versions")), false);
  assert.equal(existsSync(join(homes.mixed, "notes.txt")), true);
  assert.equal(existsSync(join(homes.mixed, "MOVED.json")), true);
});
