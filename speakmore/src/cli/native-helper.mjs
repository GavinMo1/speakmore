import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

// 原生小帮手（native/main.swift：听热键、贴字）的可执行文件从哪来。
// 从 npm 装的包里带着编好的，两种芯片都能跑；从源码仓库跑的话，第一次启动和改过源码之后在本机现编。

/** Electron 44 支持的最低系统版本，小帮手跟它保持一致 */
const MIN_MACOS = "12.0";
const UNIVERSAL_ARCHS = ["arm64", "x86_64"];

export function helperPaths(packageDir) {
  return { source: join(packageDir, "native", "main.swift"), binary: join(packageDir, "build", "key-helper") };
}

function statOrNull(file) {
  try {
    return statSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * 要不要（重新）编译：没有可执行文件，或者源码比它新。
 * 装好的包里两个文件的时间是一样的，不会触发编译，所以用的人不需要装编译工具。
 */
export function helperNeedsBuild({ source, binary }, stat = statOrNull) {
  const built = stat(binary);
  if (!built) return true;
  const written = stat(source);
  return written !== null && written.mtimeMs > built.mtimeMs;
}

function compile(run, args) {
  try {
    run("swiftc", args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("编译按键监听的小程序需要 Xcode 命令行工具。先运行：xcode-select --install");
    }
    const detail = String(error.stderr ?? "").trim() || error.message;
    throw new Error(
      `按键监听的小程序没有编译成功（没装 Xcode 命令行工具的话先运行 xcode-select --install）：\n${detail}`,
    );
  }
}

/**
 * 编译小帮手。
 * @param {string} packageDir
 * @param {object} [options]
 * @param {boolean} [options.universal] 两种芯片各编一份再合成一个文件，发布时用
 */
export function buildHelper(
  packageDir,
  { universal = false, run = execFileSync, mkdir = mkdirSync, remove = rmSync } = {},
) {
  const { source, binary } = helperPaths(packageDir);
  mkdir(dirname(binary), { recursive: true });
  if (!universal) {
    compile(run, ["-O", "-o", binary, source]);
    return;
  }
  const slices = UNIVERSAL_ARCHS.map((arch) => `${binary}-${arch}`);
  UNIVERSAL_ARCHS.forEach((arch, index) => {
    compile(run, ["-O", "-target", `${arch}-apple-macos${MIN_MACOS}`, "-o", slices[index], source]);
  });
  run("lipo", ["-create", "-output", binary, ...slices]);
  for (const slice of slices) remove(slice, { force: true });
}

/** 需要的话编译一次。@returns {boolean} 这次有没有编 */
export function ensureHelper(packageDir, { stat = statOrNull, ...buildOptions } = {}) {
  if (!helperNeedsBuild(helperPaths(packageDir), stat)) return false;
  buildHelper(packageDir, buildOptions);
  return true;
}
