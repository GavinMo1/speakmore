#!/usr/bin/env node
// 把客户端打成一个可以双击的 macOS 应用：dist/Typeless Clone-darwin-<架构>/Typeless Clone.app
// 用法：npm run dist
//
// 应用里装三样东西：这个目录的 src（主进程和页面）、build/key-helper（原生小帮手），
// 以及 ../server 的源码和运行时依赖。服务端放在 Resources/server，
// 和 src/main/service.mjs 的相对位置同开发时一样，所以那边的 import 不用改。

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { packager } from "@electron/packager";

const clientDir = resolve(import.meta.dirname, "..");
const serverDir = resolve(clientDir, "../server");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
/** 应用名只在 package.json 的 productName 里写一次：钥匙串条目、日志目录、应用包都跟着它 */
const APP_NAME = readJson(join(clientDir, "package.json")).productName;
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });

run("npm", ["run", "build:native"], clientDir);

const staging = mkdtempSync(join(tmpdir(), "clone-package-"));
try {
  // 服务端只带源码和运行时依赖：测试、脚本、开发依赖都不进应用
  const stagedServer = join(staging, "server");
  for (const entry of ["package.json", "package-lock.json", "src"]) {
    cpSync(join(serverDir, entry), join(stagedServer, entry), { recursive: true });
  }
  run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], stagedServer);

  const icon = join(clientDir, "assets", "icon.icns");
  const [bundleDir] = await packager({
    dir: clientDir,
    out: join(clientDir, "dist"),
    overwrite: true,
    name: APP_NAME,
    appBundleId: "local.typeless-clone",
    appCategoryType: "public.app-category.productivity",
    platform: "darwin",
    arch: process.arch,
    electronVersion: readJson(join(clientDir, "node_modules/electron/package.json")).version,
    // 不打成 asar：原生小帮手要能直接执行，页面和主进程的路径也和开发时保持一致
    asar: false,
    prune: true,
    ignore: [/^\/(test|scripts|native|dist|assets)($|\/)/, /^\/biome\.json$/],
    extraResource: [stagedServer],
    ...(existsSync(icon) ? { icon } : {}),
    extendInfo: {
      // 只待在菜单栏，不占程序坞
      LSUIElement: true,
      NSMicrophoneUsageDescription: "听写需要用麦克风录下你说的话。",
    },
  });

  const appPath = join(bundleDir, `${APP_NAME}.app`);
  // 改过 Info.plist、加过资源之后原来的签名就作废了，Apple 芯片上没有有效签名的应用打不开。
  // 这里签的是不带身份的本机签名：只能在这台机器上用，重新打包后系统会当成另一个应用，三项权限要重新给。
  run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  run("codesign", ["--verify", "--deep", "--strict", appPath]);
  console.log(`\n打好了：${appPath}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
