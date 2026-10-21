#!/usr/bin/env node
// 编译原生小帮手。
// 用法：npm run build:native              只编本机的（macOS 上是 native/mac/ → build/key-helper，本机的架构）
//       node scripts/build/build-native.mjs --universal   macOS 的两种芯片合一（打发布包时 release.mjs 自己会这样编）
//       node scripts/build/build-native.mjs --windows     Windows 的（native/windows → build/key-helper.exe），在 Mac 上交叉编译
import { resolve } from "node:path";
import { buildHelper, helperPaths } from "../../src/cli/native-helper.mjs";

const packageDir = resolve(import.meta.dirname, "../..");
const platform = process.argv.includes("--windows") ? "win32" : process.platform;
try {
  buildHelper(packageDir, { platform, universal: process.argv.includes("--universal") });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`编好了：${helperPaths(packageDir, platform).binary}`);
