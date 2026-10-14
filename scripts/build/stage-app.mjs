// 在一个临时目录里摆出"装到别人机器上的程序该有的东西"：代码、编好的小帮手、运行时依赖。
// 打 .app（package.mjs）和打发布包（release.mjs）都从这里开始。

import { execFileSync } from "node:child_process";
import { cpSync } from "node:fs";
import { join } from "node:path";

const NPM_FLAGS = ["--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"];

/**
 * @param {string} packageDir 源码仓库
 * @param {string} stagingDir 摆到哪。要是一个空目录
 * @param {string[]} entries 除了 package.json 和锁文件之外，还要从仓库里拷哪些
 */
export function stageApp(packageDir, stagingDir, entries) {
  for (const entry of ["package.json", "package-lock.json", ...entries]) {
    cpSync(join(packageDir, entry), join(stagingDir, entry), { recursive: true });
  }
  const npm = (args) => execFileSync("npm", [...args, ...NPM_FLAGS], { cwd: stagingDir, stdio: "inherit" });
  // 不直接拿源码仓库让打包工具去剔开发依赖：实测它剔不干净，代码检查工具几十兆的可执行文件会被带进去
  npm(["ci"]);
  // electron 这个依赖是给从源码仓库跑的人找运行环境用的。装好的程序另有运行环境，不用带它和它的下载工具
  // （这里也要 --omit=dev：不带的话 uninstall 会顺手把开发依赖全装回来）
  npm(["uninstall", "electron"]);
  // 卸掉之后会剩下几个空目录（node_modules/@electron 之类）
  execFileSync("find", [join(stagingDir, "node_modules"), "-type", "d", "-empty", "-delete"]);
}
