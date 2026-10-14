#!/usr/bin/env node
// 把 SpeakMore 打成一个可以双击的 macOS 应用：dist/SpeakMore-darwin-<架构>/SpeakMore.app
// 用法：npm run dist
//
// 平时用 speakmore 命令启动就够了。打成应用的区别是：三项系统权限记在"SpeakMore"自己名下
// （而不是启动它的终端名下），并且可以设成登录时自动启动。
// 应用里装的是 src、编好的小帮手和运行时依赖；测试、脚本、命令行入口都不进去。

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { packager } from "@electron/packager";
import { buildHelper } from "../../src/cli/native-helper.mjs";
import { APP_ENTRIES, stageApp } from "./stage-app.mjs";

const packageDir = resolve(import.meta.dirname, "../..");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
/** 应用名只在 package.json 的 productName 里写一次：钥匙串条目和应用包都跟着它 */
const APP_NAME = readJson(join(packageDir, "package.json")).productName;
const run = (command, args) => execFileSync(command, args, { cwd: packageDir, stdio: "inherit" });

buildHelper(packageDir);

// 先在一个临时目录里摆出"应用里该有的东西"，只装运行时依赖，再从那里打包
const staging = mkdtempSync(join(tmpdir(), "speakmore-package-"));
let bundleDir;
try {
  stageApp(packageDir, staging, APP_ENTRIES);
  [bundleDir] = await packageApp(staging);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

const appPath = join(bundleDir, `${APP_NAME}.app`);
// 改过 Info.plist、加过资源之后原来的签名就作废了，Apple 芯片上没有有效签名的应用打不开。
// 这里签的是不带身份的本机签名：只能在这台机器上用，重新打包后系统会当成另一个应用，三项权限要重新给。
run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
run("codesign", ["--verify", "--deep", "--strict", appPath]);
console.log(`\n打好了：${appPath}`);

function packageApp(dir) {
  const icon = join(packageDir, "assets", "icon.icns");
  return packager({
    dir,
    out: join(packageDir, "dist"),
    overwrite: true,
    name: APP_NAME,
    appBundleId: "local.speakmore",
    appCategoryType: "public.app-category.productivity",
    platform: "darwin",
    arch: process.arch,
    electronVersion: readJson(join(packageDir, "node_modules/electron/package.json")).version,
    // 不打成 asar：原生小帮手要能直接执行，页面和主进程的路径也和开发时保持一致
    asar: false,
    // 依赖在上面已经只装了运行时的那部分
    prune: false,
    ignore: [/^\/src\/cli($|\/)/, /^\/package-lock\.json$/],
    ...(existsSync(icon) ? { icon } : {}),
    extendInfo: {
      // 只待在菜单栏，不占程序坞
      LSUIElement: true,
      NSMicrophoneUsageDescription: "听写需要用麦克风录下你说的话。",
    },
  });
}
