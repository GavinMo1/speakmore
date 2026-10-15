#!/usr/bin/env node
// 把 SpeakMore 打成一个可以双击的 macOS 应用：dist/SpeakMore-darwin-<架构>/SpeakMore.app
// 用法：npm run dist
//
// 平时用 speakmore 命令启动就够了。打成应用的区别是：三项系统权限记在"SpeakMore"自己名下
// （而不是启动它的终端名下），并且可以设成登录时自动启动。
// 应用里装的是 src、编好的小帮手和运行时依赖；测试、脚本、命令行入口都不进去。
//
// 签名：本机配了 Developer ID（见 signing.mjs）就用它签、开 hardened runtime，再配了公证档案就交给苹果公证、
// 钉上票据，这样的应用拿到别的 Mac 上也能直接打开，重新打包后权限和 key 也不用重给。都没配就是不带身份的本机签名。

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { packager } from "@electron/packager";
import { buildHelper } from "../../src/cli/native-helper.mjs";
import { osxSignOptions, signingConfig } from "./signing.mjs";
import { APP_ENTRIES, stageApp } from "./stage-app.mjs";

const packageDir = resolve(import.meta.dirname, "../..");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
/** 应用名只在 package.json 的 productName 里写一次：钥匙串条目和应用包都跟着它 */
const APP_NAME = readJson(join(packageDir, "package.json")).productName;
const run = (command, args) => execFileSync(command, args, { cwd: packageDir, stdio: "inherit" });
// 先读：配错了在编译、打包之前就说
const signing = signingConfig(packageDir);

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
if (signing === null) {
  // 改过 Info.plist、加过资源之后原来的签名就作废了，Apple 芯片上没有有效签名的应用打不开。
  // 这里签的是不带身份的本机签名：只能在这台机器上用，重新打包后系统会当成另一个应用，三项权限要重新给。
  run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
}
run("codesign", ["--verify", "--deep", "--strict", appPath]);
if (signing?.notaryProfile) {
  // 公证过、钉了票据的，系统的放行检查（Gatekeeper）离线也认
  run("xcrun", ["stapler", "validate", appPath]);
  run("spctl", ["--assess", "--type", "execute", "--verbose", appPath]);
}
const how = signing === null ? "本机签名" : `${signing.identity}${signing.notaryProfile ? "，已公证" : "，没公证"}`;
console.log(`\n打好了（${how}）：${appPath}`);

function packageApp(dir) {
  const icon = join(packageDir, "assets", "icon.icns");
  return packager({
    dir,
    out: join(packageDir, "dist"),
    overwrite: true,
    name: APP_NAME,
    // 签了名以后，系统按"这个标识 + 这张证书的团队"认应用：权限、钥匙串都记在它名下，以后别再改
    appBundleId: "com.zephyrxiang.speakmore",
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
    ...(signing && { osxSign: osxSignOptions(signing.identity) }),
    // 公证要传到苹果那边排队，一般几分钟；交上去的是打好的应用，回来后钉上票据
    ...(signing?.notaryProfile && { osxNotarize: { keychainProfile: signing.notaryProfile } }),
  });
}
