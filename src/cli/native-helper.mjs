import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LocalizedError, msg } from "../i18n/index.mjs";

// 原生小帮手（听热键、贴字）的可执行文件从哪来。每个系统一份，和父进程说的话一样（src/app/helper.mjs）：
//   macOS    native/main.swift  → build/key-helper      swiftc 编，发布时两种芯片合一
//   Windows  native/windows/    → build/key-helper.exe  Go 编（scripts/build/go.sh 在 Mac 上交叉编译）
// 装好的程序里带着编好的，不带源码；从源码仓库跑的话，第一次启动和改过源码之后在本机现编。

/** Electron 44 支持的最低系统版本，小帮手跟它保持一致 */
const MIN_MACOS = "12.0";
const UNIVERSAL_ARCHS = ["arm64", "x86_64"];

/**
 * @param {string} packageDir
 * @param {NodeJS.Platform} [platform] 给哪个系统的
 */
export function helperPaths(packageDir, platform = process.platform) {
  const windows = platform === "win32";
  const binary = join(packageDir, "build", windows ? "key-helper.exe" : "key-helper");
  return {
    // Windows 的是一个目录（Go 的模块），macOS 的是一个文件
    source: windows ? join(packageDir, "native", "windows") : join(packageDir, "native", "main.swift"),
    binary,
    /** 可执行文件是从哪份源码编出来的：那份源码的 SHA-256 */
    stamp: `${binary}.source-sha256`,
  };
}

function readOrNull(file) {
  try {
    return readFileSync(file);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") return null;
    throw error;
  }
}

/** 目录里的文件名；不是目录（或者不在）是 null */
function listOrNull(dir) {
  try {
    return readdirSync(dir);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

/**
 * 源码的内容，用来算指纹：一个文件就是它本身（和 0.8 以前算的一样，编好的不用重编）；
 * 一个 Go 模块是 go.mod 和除了测试以外的 .go 文件，按名字排好、带着名字拼在一起。源码不在是 null
 */
function sourceContent(source, read, list) {
  const names = list(source);
  if (names === null) return read(source);
  const parts = names
    .filter((name) => name === "go.mod" || (name.endsWith(".go") && !name.endsWith("_test.go")))
    .sort()
    .flatMap((name) => [Buffer.from(`${name}\0`), read(join(source, name)) ?? Buffer.alloc(0), Buffer.from("\0")]);
  return parts.length === 0 ? null : Buffer.concat(parts);
}

const fingerprint = (content) => createHash("sha256").update(content).digest("hex");

/**
 * 要不要（重新）编译：没有可执行文件，或者它不是从现在这份源码编出来的。
 * 不比文件的修改时间：解包、git 检出都会把时间改成当时，实测装好的包里源码反而比可执行文件"新"，
 * 结果在没装编译工具的机器上白白去编一次然后失败。
 */
export function helperNeedsBuild({ source, binary, stamp }, read = readOrNull, list = listOrNull) {
  if (read(binary) === null) return true;
  const written = sourceContent(source, read, list);
  if (written === null) return false;
  return read(stamp)?.toString().trim() !== fingerprint(written);
}

/** 跑编译器。没装（找不到命令）和编出错各说各的；messages：{ missing, failed } 两句话的键 */
function compile(run, command, args, options, messages) {
  try {
    run(command, args, { stdio: ["ignore", "ignore", "pipe"], ...options });
  } catch (error) {
    if (error.code === "ENOENT") throw new LocalizedError(msg(messages.missing), { cause: error });
    const detail = String(error.stderr ?? "").trim() || error.message;
    throw new LocalizedError(msg(messages.failed, { detail }), { cause: error });
  }
}

const SWIFT = { missing: "cli.daemon.needXcode", failed: "cli.daemon.buildFailed" };
const GO = { missing: "cli.daemon.needGo", failed: "cli.daemon.buildFailedGo" };

/**
 * Go 在哪：在 Windows 上就用装着的 go；在别的系统上（发布、交叉编译）用项目自带的那份（scripts/build/go.sh，
 * 第一次用时下载进 .tools/）
 */
const goCommand = (packageDir, host) => (host === "win32" ? "go" : join(packageDir, "scripts", "build", "go.sh"));

/**
 * 编译小帮手，并记下它是从哪份源码来的。
 * @param {string} packageDir
 * @param {object} [options]
 * @param {NodeJS.Platform} [options.platform] 给哪个系统编：win32 编 Windows 的（在 Mac 上就是交叉编译）
 * @param {boolean} [options.universal] macOS 的两种芯片各编一份再合成一个文件，发布时用
 */
export function buildHelper(
  packageDir,
  {
    platform = process.platform,
    host = process.platform,
    universal = false,
    run = execFileSync,
    mkdir = mkdirSync,
    remove = rmSync,
    read = readOrNull,
    list = listOrNull,
    write = writeFileSync,
  } = {},
) {
  const { source, binary, stamp } = helperPaths(packageDir, platform);
  mkdir(dirname(binary), { recursive: true });
  if (platform === "win32") {
    // -H windowsgui：不是控制台程序，被起来时不会闪出一个黑窗口；标准输入输出照样接得上
    compile(
      run,
      goCommand(packageDir, host),
      ["build", "-trimpath", "-ldflags", "-s -w -H windowsgui", "-o", binary, "."],
      { cwd: source, env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" } },
      GO,
    );
  } else if (universal) {
    const slices = UNIVERSAL_ARCHS.map((arch) => `${binary}-${arch}`);
    UNIVERSAL_ARCHS.forEach((arch, index) => {
      compile(
        run,
        "swiftc",
        ["-O", "-target", `${arch}-apple-macos${MIN_MACOS}`, "-o", slices[index], source],
        {},
        SWIFT,
      );
    });
    run("lipo", ["-create", "-output", binary, ...slices]);
    for (const slice of slices) remove(slice, { force: true });
  } else {
    compile(run, "swiftc", ["-O", "-o", binary, source], {}, SWIFT);
  }
  write(stamp, `${fingerprint(sourceContent(source, read, list))}\n`);
}

/**
 * 需要的话编译一次（本机这个系统的）。编译要十几秒，所以动手之前先调 onBuild，让调用方有机会说一声。
 * @returns {boolean} 这次有没有编
 */
export function ensureHelper(
  packageDir,
  { read = readOrNull, list = listOrNull, onBuild = () => {}, platform = process.platform, ...buildOptions } = {},
) {
  if (!helperNeedsBuild(helperPaths(packageDir, platform), read, list)) return false;
  onBuild();
  buildHelper(packageDir, { read, list, platform, ...buildOptions });
  return true;
}
