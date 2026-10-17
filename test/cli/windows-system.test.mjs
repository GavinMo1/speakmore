import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { isOurShortcut, removeLoginItem, removePathEntry } from "../../src/cli/windows-system.mjs";

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

test("没有那一项时如实说没有，不报错：开机启动、Path 里都没有这个家目录的", windowsOnly, () => {
  // 家目录是编出来的：真装着的那份的开机启动、Path 不会被碰到（只删指着这个家目录的）
  const home = join(tmpdir(), "sm-winsys-nowhere", ".speakmore");
  assert.equal(removeLoginItem(home), false);
  assert.equal(removePathEntry(join(home, "bin")), false);
});

test(
  "快捷方式是不是我们的：照 Windows 读出来的目标认，指着这个家目录里的运行环境才算（路径里有中文也认得）",
  windowsOnly,
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "sm-快捷方式-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const home = join(dir, "用户", ".speakmore");
    const make = (name, target) => {
      const file = join(dir, name);
      // 和 install.ps1 的 Add-Shortcut 一样用 WScript.Shell 建；目标不用真的存在
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath = $env:TARGET; $s.Arguments = $env:ARGS; $s.Save()",
        ],
        { env: { ...process.env, LNK: file, TARGET: target, ARGS: `"${join(home, "app")}"` } },
      );
      return file;
    };
    assert.equal(isOurShortcut(make("ours.lnk", join(home, "runtime", "electron.exe")), home), true);
    assert.equal(isOurShortcut(make("theirs.lnk", join(dir, "别的", "runtime", "electron.exe")), home), false);
    assert.equal(isOurShortcut(join(dir, "missing.lnk"), home), false);
  },
);
