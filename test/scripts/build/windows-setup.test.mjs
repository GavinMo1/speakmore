import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { buildWindowsSetup, fileVersion, SETUP_MAGIC, setupTrailer } from "../../../scripts/build/windows-setup.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-setup-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("尾巴：8 字节记号加 8 字节小端的 zip 长度，和 native/windows-setup/payload.go 读的一样", () => {
  const trailer = setupTrailer(0x0102030405);
  assert.equal(trailer.length, 16);
  assert.equal(trailer.subarray(0, 8).toString("ascii"), SETUP_MAGIC);
  assert.equal(trailer.readBigUInt64LE(8), 0x0102030405n);
});

test("文件版本只认四段数字：预发版本号取前三段", () => {
  assert.equal(fileVersion("0.9.0"), "0.9.0.0");
  assert.equal(fileVersion("0.9.0-rc.1"), "0.9.0.0");
});

test("拼法：程序在前，接着只存不压的 zip（版本目录里的包和校验值、install.ps1、latest），最后是尾巴；编译时生成的资源文件不留", () => {
  const packageDir = join(dir, "repo");
  const source = join(packageDir, "native", "windows-setup");
  mkdirSync(source, { recursive: true });
  mkdirSync(join(packageDir, "assets"));
  writeFileSync(join(packageDir, "install.ps1"), "& { 'install' }\n");
  const archive = join(dir, "speakmore-win32-x64.zip");
  writeFileSync(archive, "程序包");
  writeFileSync(`${archive}.sha256`, "abc  speakmore-win32-x64.zip\n");
  const calls = [];
  // 假的 go 和 zip：记下怎么调的，把该产出的文件写出来
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    if (args[1]?.startsWith("github.com/tc-hib/go-winres"))
      writeFileSync(join(source, "rsrc_windows_amd64.syso"), "资源");
    if (args[0] === "build") writeFileSync(args[args.indexOf("-o") + 1], "MZ 安装程序");
    if (command === "zip") {
      const staged = options.cwd;
      // 摆好的东西都在：下面的 zip 用它们的内容拼一个"包"
      const content = [
        "install.ps1",
        "latest",
        "v0.9.0/speakmore-win32-x64.zip",
        "v0.9.0/speakmore-win32-x64.zip.sha256",
      ]
        .map((name) => `${name}=${readFileSync(join(staged, name), "utf8")}`)
        .join("|");
      writeFileSync(
        args.find((arg) => arg.endsWith(".zip")),
        content,
      );
    }
  };
  const out = join(dir, "SpeakMore-Setup-x64.exe");
  buildWindowsSetup({ packageDir, version: "0.9.0", versionDir: "v0.9.0", archive, out, run });

  const winres = calls.find(({ args }) => args[1]?.startsWith("github.com/tc-hib/go-winres"));
  assert.ok(winres.args.includes("--manifest") && winres.args[winres.args.indexOf("--manifest") + 1] === "cli");
  assert.ok(!winres.args.includes("--admin"), "不要管理员权限");
  assert.equal(winres.options.env?.GOOS, undefined, "go-winres 是在这台机器上跑的工具，不交叉编译");
  const build = calls.find(({ args }) => args[0] === "build");
  assert.equal(build.options.env.GOOS, "windows");
  const zip = calls.find(({ command }) => command === "zip");
  assert.ok(zip.args.includes("-0"), "只存不压：程序包本来就压过了");

  const bytes = readFileSync(out);
  const program = Buffer.from("MZ 安装程序");
  assert.deepEqual(bytes.subarray(0, program.length), program);
  const trailer = bytes.subarray(bytes.length - 16);
  assert.equal(trailer.subarray(0, 8).toString("ascii"), SETUP_MAGIC);
  const payloadLength = Number(trailer.readBigUInt64LE(8));
  assert.equal(program.length + payloadLength + 16, bytes.length);
  const payload = bytes.subarray(program.length, program.length + payloadLength).toString();
  assert.equal(
    payload,
    "install.ps1=& { 'install' }\n|latest=v0.9.0\n|v0.9.0/speakmore-win32-x64.zip=程序包|v0.9.0/speakmore-win32-x64.zip.sha256=abc  speakmore-win32-x64.zip\n",
  );
  assert.equal(existsSync(join(source, "rsrc_windows_amd64.syso")), false);
});
