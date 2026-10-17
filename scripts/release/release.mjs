#!/usr/bin/env node
// 打发布包：一个自带一切的压缩包，安装脚本（install.sh）把它解进 ~/.speakmore 就能用。
// 用法：npm run release              两种芯片的 Mac 各打一个，再打一个 Windows 的
//       npm run release -- arm64     只打一种（arm64、x64，或者 windows）
//
// 产物在 dist/release/，摆成下载地址上的样子（见 release-layout.mjs），所以它本身就能当下载地址用，
// 发新版本用 npm run ship，它会调这里打包、再传上去。包里有两个目录，解开后直接就是家目录里的样子：
//   app/      程序：代码、运行时依赖、编好的小帮手（两种芯片合一）
//   runtime/  运行环境：原版的 Electron.app。命令行和后台应用都用它跑，所以用的人不需要装 Node
// 装的人不需要 npm、Node、Xcode：这些活都在这里做完了。
//
// Windows 的包（speakmore-win32-x64.zip）也在这台 Mac 上打：一样是 app\ 和 runtime\（原版的 Electron），
// install.ps1 把它解进 %USERPROFILE%\.speakmore。小帮手用项目自带的 Go 交叉编译（scripts/build/go.sh），
// 运行库按 win32-x64 装（npm 的 --os、--cpu）。没签名：Windows 上暂时不签（见 docs/development.md）。
//
// 另外每种芯片打一个直接下载的安装包（SpeakMore-<芯片>.dmg）：签了名、过了公证的 SpeakMore.app，
// 要本机配好签名和公证（.machine.env 的 MAC_SIGNING_IDENTITY、MAC_NOTARY_PROFILE），没配就不打，发布时会因为缺它传不上去。

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { downloadArtifact } from "@electron/get";
import { buildHelper } from "../../src/cli/native-helper.mjs";
import { makeDmg } from "../build/dmg.mjs";
import { packageMacApp } from "../build/mac-app.mjs";
import { signingConfig } from "../build/signing.mjs";
import { APP_ENTRIES, stageApp } from "../build/stage-app.mjs";
import { ARCHS, archiveName, dmgName, sha256, versionDir, WINDOWS_ARCHIVE } from "./release-layout.mjs";

const packageDir = resolve(import.meta.dirname, "../..");
const outDir = join(packageDir, "dist", "release");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const megabytes = (file) => `${(statSync(file).size / 1024 / 1024).toFixed(0)} MB`;

const WINDOWS = "windows";
const wanted = process.argv.slice(2);
const unknown = wanted.filter((arch) => !ARCHS.includes(arch) && arch !== WINDOWS);
if (unknown.length > 0) {
  console.error(`不认识的芯片：${unknown.join("、")}。能填：${[...ARCHS, WINDOWS].join(" / ")}`);
  process.exit(2);
}
const archs = wanted.length > 0 ? wanted.filter((arch) => arch !== WINDOWS) : ARCHS;
const windows = wanted.length === 0 || wanted.includes(WINDOWS);
// 先读：配错了在编译、打包之前就说
const signing = signingConfig(packageDir);

const { version } = readJson(join(packageDir, "package.json"));
const electronDir = join(packageDir, "node_modules", "electron");
const electronVersion = readJson(join(electronDir, "package.json")).version;
/** electron 这个包里带着每个下载件应有的 SHA-256，而它自己的完整性由我们的锁文件管着 */
const electronChecksums = readJson(join(electronDir, "checksums.json"));

/** 下载（有缓存就用缓存）这个系统、这种芯片的 Electron，核对过校验值之后解到 dest 里 */
async function addRuntime(platform, arch, dest) {
  const zip = await downloadArtifact({ version: electronVersion, platform, arch, artifactName: "electron" });
  const name = `electron-v${electronVersion}-${platform}-${arch}.zip`;
  const expected = electronChecksums[name];
  const actual = sha256(zip);
  if (!expected || actual !== expected) {
    throw new Error(`${name} 的校验值对不上：应该是 ${expected ?? "（表里没有）"}，下到的是 ${actual}`);
  }
  mkdirSync(dest, { recursive: true });
  // ditto 解出来的应用包保留着符号链接和签名；unzip 对其中的符号链接处理得不可靠
  execFileSync("ditto", ["-x", "-k", zip, dest]);
}

if (archs.length > 0) buildHelper(packageDir, { universal: true });
if (windows) buildHelper(packageDir, { platform: "win32" });

const staging = mkdtempSync(join(tmpdir(), "speakmore-release-"));
try {
  // 上一次打的不留：里面要是混着别的版本，传上去的就不是这一次的
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, versionDir(version)), { recursive: true });
  for (const arch of archs) {
    // 每种芯片单独摆一份：本地转写的运行库带着那种芯片的原生库
    const appDir = join(staging, "app");
    rmSync(appDir, { recursive: true, force: true });
    mkdirSync(appDir);
    stageApp(packageDir, appDir, ["bin", ...APP_ENTRIES, "LICENSE"], arch);
    // 锁文件只在上一步装依赖时用得上
    rmSync(join(appDir, "package-lock.json"));

    const runtimeDir = join(staging, "runtime");
    rmSync(runtimeDir, { recursive: true, force: true });
    await addRuntime("darwin", arch, runtimeDir);

    const archive = join(outDir, versionDir(version), archiveName(arch));
    execFileSync("tar", ["-czf", archive, "-C", staging, "app", "runtime"], {
      // 不让 macOS 的 tar 把扩展属性存成一堆 ._ 开头的文件
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    // 和 shasum -a 256 的输出同一种格式，安装脚本直接拿来核对
    writeFileSync(`${archive}.sha256`, `${sha256(archive)}  ${basename(archive)}\n`);
    console.log(`打好了：${archive}（${megabytes(archive)}）`);
  }

  if (windows) {
    for (const name of ["app", "runtime"]) rmSync(join(staging, name), { recursive: true, force: true });
    const appDir = join(staging, "app");
    mkdirSync(appDir);
    stageApp(packageDir, appDir, ["bin", ...APP_ENTRIES, "LICENSE"], "x64", "win32");
    rmSync(join(appDir, "package-lock.json"));
    await addRuntime("win32", "x64", join(staging, "runtime"));
    const archive = join(outDir, versionDir(version), WINDOWS_ARCHIVE);
    // zip 而不是 tar.gz：Windows 自带的 PowerShell 5.1 用 .NET 就解得开。-X 不存 Unix 的属主这些
    execFileSync("zip", ["-q", "-r", "-X", archive, "app", "runtime"], { cwd: staging });
    writeFileSync(`${archive}.sha256`, `${sha256(archive)}  ${basename(archive)}\n`);
    console.log(`打好了：${archive}（${megabytes(archive)}）`);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

// 没公证过的 dmg 下回来系统不让开，所以签名和公证都配了才打
if (signing?.notaryProfile) {
  const appsDir = mkdtempSync(join(tmpdir(), "speakmore-apps-"));
  try {
    for (const arch of archs) {
      const appPath = await packageMacApp({ packageDir, arch, out: appsDir, signing });
      const dmg = join(outDir, versionDir(version), dmgName(arch));
      makeDmg({ appPath, dmgPath: dmg, signing });
      writeFileSync(`${dmg}.sha256`, `${sha256(dmg)}  ${basename(dmg)}\n`);
      console.log(`打好了：${dmg}（${megabytes(dmg)}）`);
    }
  } finally {
    rmSync(appsDir, { recursive: true, force: true });
  }
} else {
  console.warn(
    "没配签名和公证（.machine.env 的 MAC_SIGNING_IDENTITY、MAC_NOTARY_PROFILE），不打安装包；发布时缺了它传不上去",
  );
}

// 安装脚本和发布包放在一起：下载地址上的和仓库里的是同一份
cpSync(join(packageDir, "install.sh"), join(outDir, "install.sh"));
cpSync(join(packageDir, "install.ps1"), join(outDir, "install.ps1"));
writeFileSync(join(outDir, "latest"), `${versionDir(version)}\n`);
console.log(`\nSpeakMore ${version}（Electron ${electronVersion}）的发布包在 ${outDir}`);
