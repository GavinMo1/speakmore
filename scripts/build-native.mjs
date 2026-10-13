#!/usr/bin/env node
// 编译原生小帮手（native/main.swift → build/key-helper）。
// 用法：npm run build:native              只编本机的架构
//       node scripts/build-native.mjs --universal   两种芯片合一，打 npm 包之前自动跑（prepack）
import { resolve } from "node:path";
import { buildHelper, helperPaths } from "../src/cli/native-helper.mjs";

const packageDir = resolve(import.meta.dirname, "..");
try {
  buildHelper(packageDir, { universal: process.argv.includes("--universal") });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`编好了：${helperPaths(packageDir).binary}`);
