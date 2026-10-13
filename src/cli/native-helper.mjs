import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// 原生小帮手（native/main.swift：听热键、贴字）的可执行文件从哪来。
// 装好的程序里带着编好的，两种芯片都能跑，也不带源码；从源码仓库跑的话，第一次启动和改过源码之后在本机现编。

/** Electron 44 支持的最低系统版本，小帮手跟它保持一致 */
const MIN_MACOS = "12.0";
const UNIVERSAL_ARCHS = ["arm64", "x86_64"];

export function helperPaths(packageDir) {
  const binary = join(packageDir, "build", "key-helper");
  return {
    source: join(packageDir, "native", "main.swift"),
    binary,
    /** 可执行文件是从哪份源码编出来的：那份源码的 SHA-256 */
    stamp: `${binary}.source-sha256`,
  };
}

function readOrNull(file) {
  try {
    return readFileSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const fingerprint = (source) => createHash("sha256").update(source).digest("hex");

/**
 * 要不要（重新）编译：没有可执行文件，或者它不是从现在这份源码编出来的。
 * 不比文件的修改时间：解包、git 检出都会把时间改成当时，实测装好的包里源码反而比可执行文件"新"，
 * 结果在没装编译工具的机器上白白去编一次然后失败。
 */
export function helperNeedsBuild({ source, binary, stamp }, read = readOrNull) {
  if (read(binary) === null) return true;
  const written = read(source);
  if (written === null) return false;
  return read(stamp)?.toString().trim() !== fingerprint(written);
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
 * 编译小帮手，并记下它是从哪份源码来的。
 * @param {string} packageDir
 * @param {object} [options]
 * @param {boolean} [options.universal] 两种芯片各编一份再合成一个文件，发布时用
 */
export function buildHelper(
  packageDir,
  {
    universal = false,
    run = execFileSync,
    mkdir = mkdirSync,
    remove = rmSync,
    read = readOrNull,
    write = writeFileSync,
  } = {},
) {
  const { source, binary, stamp } = helperPaths(packageDir);
  mkdir(dirname(binary), { recursive: true });
  if (universal) {
    const slices = UNIVERSAL_ARCHS.map((arch) => `${binary}-${arch}`);
    UNIVERSAL_ARCHS.forEach((arch, index) => {
      compile(run, ["-O", "-target", `${arch}-apple-macos${MIN_MACOS}`, "-o", slices[index], source]);
    });
    run("lipo", ["-create", "-output", binary, ...slices]);
    for (const slice of slices) remove(slice, { force: true });
  } else {
    compile(run, ["-O", "-o", binary, source]);
  }
  write(stamp, `${fingerprint(read(source))}\n`);
}

/**
 * 需要的话编译一次。编译要十几秒，所以动手之前先调 onBuild，让调用方有机会说一声。
 * @returns {boolean} 这次有没有编
 */
export function ensureHelper(packageDir, { read = readOrNull, onBuild = () => {}, ...buildOptions } = {}) {
  if (!helperNeedsBuild(helperPaths(packageDir), read)) return false;
  onBuild();
  buildHelper(packageDir, { read, ...buildOptions });
  return true;
}
