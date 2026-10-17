import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { currentUserSid } from "../../src/storage/owner-only.mjs";

// "这个目录只有自己进得去"在两个系统上各怎么查（做法见 src/storage/owner-only.mjs）：
// macOS 看权限位；Windows 看访问控制表，只能有自己和 SYSTEM 两条，而且不是从上层继承来的。

const SYSTEM_SID = "S-1-5-18";

/** 一个目录的访问控制表：每一条是谁（SID）、是不是继承来的 */
function aclOf(path) {
  const script = `(Get-Acl -LiteralPath '${path.replace(/'/g, "''")}').Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value + '|' + $_.IsInherited }`;
  const output = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sid, inherited] = line.split("|");
      return { sid, inherited: inherited === "True" };
    });
}

export function assertOwnerOnlyDir(path) {
  if (process.platform !== "win32") {
    assert.equal(statSync(path).mode & 0o777, 0o700);
    return;
  }
  const entries = aclOf(path);
  const allowed = new Set([currentUserSid(), SYSTEM_SID]);
  assert.ok(entries.length > 0, `${path} 的访问控制表是空的`);
  for (const { sid, inherited } of entries) {
    assert.ok(allowed.has(sid), `${path} 里还有别人的条目：${sid}`);
    assert.equal(inherited, false, `${path} 里还有从上层继承来的条目：${sid}`);
  }
}
