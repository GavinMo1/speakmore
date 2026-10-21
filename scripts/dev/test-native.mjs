#!/usr/bin/env node
// 跑两个原生小帮手的测试：Windows 的（Go，native/windows/）在哪个系统上都能跑；Mac 的（Swift）只在 Mac 上跑。
// 两边都读共用的按键轨迹样例（native/fixtures/hotkeys/）。npm run check 会跑它；单独跑：npm run test:native
// Go 照 native-helper.mjs 的规矩找：Windows 上用装着的 go，别的系统上用项目自带的那份（scripts/build/go.sh）。

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { goCommand } from "../../src/cli/native-helper.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function run(label, command, args, options = {}) {
  console.log(`== ${label}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", ...options });
  if (result.error) throw new Error(`${label}：起不来 ${command}：${result.error.message}`);
  if (result.status !== 0) {
    console.error(`${label} 没过（退出码 ${result.status}）`);
    process.exit(result.status ?? 1);
  }
}

run("Windows 小帮手（Go）", goCommand(ROOT, process.platform), ["-C", "native/windows", "test", "./..."]);
