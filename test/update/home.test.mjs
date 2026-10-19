import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createTranslator, LocalizedError } from "../../src/i18n/index.mjs";
import { resolvePaths } from "../../src/storage/paths.mjs";
import { createHomes, homeArch, isHomeCopy } from "../../src/update/home.mjs";
import { createRelease } from "../../src/update/release.mjs";

const zh = createTranslator("zh-CN");
// 安装脚本按系统分：macOS 是 install.sh，Windows 是 install.ps1
const macOnly = { skip: process.platform === "win32" && "macOS 的 install.sh" };
const windowsOnly = { skip: process.platform !== "win32" && "Windows 的 install.ps1" };

let dir;
let paths;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-home-"));
  paths = resolvePaths({ SPEAKMORE_HOME: join(dir, "home") }, undefined, process.platform);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** 在 release 下摆一个假的发布：安装脚本和这个版本的包（带校验值） */
function publish(release, version, { script, scriptName, archive }) {
  mkdirSync(join(release, `v${version}`), { recursive: true });
  writeFileSync(join(release, scriptName), script);
  writeFileSync(join(release, `v${version}`, archive), `包 ${version}`);
  writeFileSync(join(release, `v${version}`, `${archive}.sha256`), `${sha256(`包 ${version}`)}  ${archive}\n`);
}

const homesFor = (release, options = {}) => {
  const env = { ...process.env, SPEAKMORE_INSTALL_BASE: release, ...options.env };
  return createHomes({
    paths,
    env,
    release: createRelease({ env }),
    stdio: ["ignore", "ignore", "ignore"],
    arch: "arm64",
    ...options,
  });
};

test("家目录里装的是哪个版本：Mac 看 app/package.json，Windows 看 current 指着的那个版本；没装、读不出的是 null", () => {
  const mac = createHomes({ paths, env: {}, release: null, stdio: "ignore", platform: "darwin" });
  assert.equal(mac.find(), null);
  mkdirSync(paths.appDir, { recursive: true });
  writeFileSync(join(paths.appDir, "package.json"), JSON.stringify({ version: "0.10.0" }));
  assert.deepEqual(mac.find(), { version: "0.10.0" });
  writeFileSync(join(paths.appDir, "package.json"), "{坏的");
  assert.equal(mac.find(), null);

  const win = createHomes({ paths, env: {}, release: null, stdio: "ignore", platform: "win32" });
  assert.equal(win.find(), null);
  mkdirSync(join(paths.versionsDir, "0.10.0-1a2b3c4d", "app"), { recursive: true });
  writeFileSync(
    join(paths.versionsDir, "0.10.0-1a2b3c4d", "app", "package.json"),
    JSON.stringify({ version: "0.10.0" }),
  );
  writeFileSync(paths.currentFile, "0.10.0-1a2b3c4d");
  assert.deepEqual(win.find(), { version: "0.10.0" });
});

test("这份程序是不是家目录里装的那一份：经过符号链接也认得出；Windows 上要在 versions 下某个版本的 app 里", () => {
  mkdirSync(paths.appDir, { recursive: true });
  assert.equal(isHomeCopy(paths.appDir, paths, "darwin"), true);
  const link = join(dir, "link");
  symlinkSync(paths.home, link);
  assert.equal(isHomeCopy(join(link, "app"), paths, "darwin"), true);
  assert.equal(isHomeCopy(dir, paths, "darwin"), false);
  assert.equal(isHomeCopy(join(dir, "nowhere"), paths, "darwin"), false);

  const version = join(paths.versionsDir, "0.1.0-1a2b3c4d", "app");
  mkdirSync(version, { recursive: true });
  assert.equal(isHomeCopy(version, paths, "win32"), true);
  assert.equal(isHomeCopy(paths.appDir, paths, "win32"), false, "0.9.2 那样直接放在 app 里的不算");
});

test("按什么芯片取包：和 install.sh 一样，Apple 芯片上转译跑的也取 arm64；Windows 只有 x64", () => {
  assert.equal(homeArch("darwin", "arm64"), "arm64");
  assert.equal(
    homeArch("darwin", "x64", () => true),
    "arm64",
  );
  assert.equal(
    homeArch("darwin", "x64", () => false),
    "x64",
  );
  assert.equal(homeArch("win32", "x64"), "x64");
});

test("先下好：安装脚本和包摆成下载地址的样子放进临时目录；校验值对不上的不留下", macOnly, async () => {
  const release = join(dir, "release");
  publish(release, "9.9.9", { script: "exit 0\n", scriptName: "install.sh", archive: "speakmore-darwin-arm64.tar.gz" });
  const homes = homesFor(release);
  const staged = await homes.stage("9.9.9");
  assert.deepEqual(readdirSync(staged.dir).sort(), ["install.sh", "latest", "v9.9.9"]);
  assert.equal(readFileSync(join(staged.dir, "latest"), "utf8"), "v9.9.9\n");
  assert.deepEqual(readdirSync(join(staged.dir, "v9.9.9")).sort(), [
    "speakmore-darwin-arm64.tar.gz",
    "speakmore-darwin-arm64.tar.gz.sha256",
  ]);
  staged.discard();
  assert.equal(existsSync(staged.dir), false);

  writeFileSync(join(release, "v9.9.9", "speakmore-darwin-arm64.tar.gz"), "路上坏了");
  const before = readdirSync(tmpdir()).filter((name) => name.startsWith("speakmore-update-")).length;
  await assert.rejects(homes.stage("9.9.9"), (error) => {
    assert.ok(error instanceof LocalizedError);
    assert.match(zh.text(error.problem), /speakmore-darwin-arm64\.tar\.gz 与发布的校验值不符/);
    return true;
  });
  const after = readdirSync(tmpdir()).filter((name) => name.startsWith("speakmore-update-")).length;
  assert.equal(after, before, "核对不过的临时目录删掉了");
});

test("装：让下好的安装脚本从临时目录装（不再联网），指定装到哪、装哪个版本、只装不启动", macOnly, async () => {
  const release = join(dir, "release");
  const record = join(dir, "record");
  // 假的安装脚本：记下拿到的参数和几个环境变量，按要求的退出码退出
  publish(release, "9.9.9", {
    script: `printf '%s|%s|%s|%s|%s\\n' "$*" "$SPEAKMORE_HOME" "$SPEAKMORE_VERSION" "$SPEAKMORE_INSTALL_BASE" "\${ELECTRON_RUN_AS_NODE:-}" > ${JSON.stringify(record)}\nexit "\${FAKE_EXIT:-0}"\n`,
    scriptName: "install.sh",
    archive: "speakmore-darwin-arm64.tar.gz",
  });
  const homes = homesFor(release, { env: { ELECTRON_RUN_AS_NODE: "1" } });
  const staged = await homes.stage("9.9.9");
  assert.equal(await homes.install(staged, "9.9.9"), 0);
  assert.equal(readFileSync(record, "utf8"), `--no-start|${paths.home}|v9.9.9|${staged.dir}|\n`);

  const failing = homesFor(release, { env: { FAKE_EXIT: "3" } });
  assert.equal(await failing.install(staged, "9.9.9"), 3);
  staged.discard();
});

test("启动：跑家目录里装好的 speakmore start，带上家目录，不带 ELECTRON_RUN_AS_NODE", macOnly, async () => {
  const record = join(dir, "start-record");
  mkdirSync(paths.binDir, { recursive: true });
  writeFileSync(
    join(paths.binDir, "speakmore"),
    `#!/bin/sh\nprintf '%s|%s|%s\\n' "$*" "$SPEAKMORE_HOME" "\${ELECTRON_RUN_AS_NODE:-}" > ${JSON.stringify(record)}\nexit 0\n`,
    { mode: 0o755 },
  );
  const homes = homesFor(join(dir, "release"), { env: { ELECTRON_RUN_AS_NODE: "1" } });
  assert.equal(await homes.start(), 0);
  assert.equal(readFileSync(record, "utf8"), `start|${paths.home}|\n`);
});

test(
  "Windows：install.ps1 按 UTF-8 读进来再跑，装哪、装哪个版本、只装不启动都走环境变量；启动走 speakmore.cmd",
  windowsOnly,
  async () => {
    const release = join(dir, "release");
    const record = join(dir, "record");
    // 假的安装脚本：记下拿到的几个环境变量（带一句中文：要按 UTF-8 读才对得上），按要求的结果收尾
    publish(release, "9.9.9", {
      script: `& { Set-Content -Encoding UTF8 -Path $env:RECORD -Value "装好了|$($env:SPEAKMORE_HOME)|$($env:SPEAKMORE_VERSION)|$($env:SPEAKMORE_NO_START)|$($env:SPEAKMORE_INSTALL_BASE)"; $global:LASTEXITCODE = [int]$env:FAKE_EXIT }\n`,
      scriptName: "install.ps1",
      archive: "speakmore-win32-x64.zip",
    });
    const homes = homesFor(release, { platform: "win32", arch: "x64", env: { RECORD: record, FAKE_EXIT: "0" } });
    const staged = await homes.stage("9.9.9");
    assert.equal(await homes.install(staged, "9.9.9"), 0);
    const said = readFileSync(record, "utf8").replace(/^﻿/, "").trim();
    assert.equal(said, `装好了|${paths.home}|v9.9.9|1|${staged.dir}`);
    const failing = homesFor(release, { platform: "win32", arch: "x64", env: { RECORD: record, FAKE_EXIT: "1" } });
    assert.equal(await failing.install(staged, "9.9.9"), 1);
    staged.discard();

    // 启动：家目录的路径里带空格也跑得起来
    const startRecord = join(dir, "start record");
    mkdirSync(paths.binDir, { recursive: true });
    writeFileSync(join(paths.binDir, "speakmore.cmd"), `@echo off\r\necho %*^|%SPEAKMORE_HOME%> "${startRecord}"\r\n`);
    assert.equal(await homes.start(), 0);
    assert.equal(readFileSync(startRecord, "utf8").trim(), `start|${paths.home}`);
  },
);
