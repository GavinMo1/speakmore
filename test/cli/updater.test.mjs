import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { compareVersions } from "../../src/cli/commands/update.mjs";
import { createUpdater, DOWNLOAD_URL, downloadBase } from "../../src/cli/updater.mjs";
import { createTranslator, LocalizedError } from "../../src/i18n/index.mjs";

const zh = createTranslator("zh-CN");

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-up-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// 安装脚本、App 这几样按系统分：macOS 是 install.sh 和 SpeakMore.app，Windows 是 install.ps1、没有单独的 App
const macOnly = { skip: process.platform === "win32" && "macOS 的安装脚本和 SpeakMore.app" };
const windowsOnly = { skip: process.platform !== "win32" && "Windows 的 install.ps1" };

test("版本号比大小：按数比，不按字比；同一个号的预发版比正式版旧", () => {
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.ok(compareVersions("0.6.0", "0.6.0-rc.1") > 0);
  assert.ok(compareVersions("0.6.0-rc.10", "0.6.0-rc.9") > 0);
  assert.equal(compareVersions("0.6.0", "0.6.0"), 0);
  assert.ok(compareVersions("0.5.9", "0.6.0") < 0);
});

test("从哪下载：和安装脚本一样，默认是发布的地址，SPEAKMORE_INSTALL_BASE 可以换成网址或者本机的目录", () => {
  assert.equal(downloadBase({}), DOWNLOAD_URL);
  assert.equal(downloadBase({ SPEAKMORE_INSTALL_BASE: "https://example.com/sm" }), "https://example.com/sm");
  assert.equal(downloadBase({ SPEAKMORE_INSTALL_BASE: "/tmp/release" }), "file:///tmp/release");
  assert.equal(downloadBase({ SPEAKMORE_INSTALL_BASE: "C:\\dist\\release" }), "file:///C:/dist/release");
});

test("真的去问、真的跑安装脚本：用本机的一个目录当下载地址", macOnly, async () => {
  const release = join(dir, "release");
  const record = join(dir, "record");
  const home = join(dir, "home");
  mkdirSync(release);
  writeFileSync(join(release, "latest"), "v9.9.9\n");
  // 假的安装脚本：记下装到哪、装哪个版本，按要求的退出码退出
  writeFileSync(
    join(release, "install.sh"),
    `printf '%s|%s|%s\\n' "$SPEAKMORE_HOME" "$SPEAKMORE_VERSION" "$#" > ${JSON.stringify(record)}\nexit "\${FAKE_EXIT:-0}"\n`,
  );
  const updater = createUpdater({ env: { ...process.env, SPEAKMORE_INSTALL_BASE: release }, home });
  assert.equal(await updater.latest(5), "v9.9.9");
  assert.equal(await updater.install("v9.9.9"), 0);
  assert.equal(readFileSync(record, "utf8"), `${home}|v9.9.9|0\n`);

  const failing = createUpdater({ env: { ...process.env, SPEAKMORE_INSTALL_BASE: release, FAKE_EXIT: "3" }, home });
  assert.equal(await failing.install("v9.9.9"), 3);
});

test("下载地址问不到：报出地址和 curl 说的原因", async () => {
  const updater = createUpdater({ env: { ...process.env, SPEAKMORE_INSTALL_BASE: join(dir, "nowhere") }, home: dir });
  for (const attempt of [() => updater.latest(5), () => updater.install("v9.9.9")]) {
    await assert.rejects(attempt, (error) => {
      assert.ok(error instanceof LocalizedError);
      const said = zh.text(error.problem);
      // 本机目录当下载地址时，Windows 上报的是它的 file:// 网址
      const where = join(dir, "nowhere");
      assert.ok(said.includes(where) || said.includes(pathToFileURL(where).href), said);
      assert.match(said, /curl/);
      return true;
    });
  }
});

// ---------- App ----------

const ARCH = process.arch === "arm64" ? "arm64" : "x64";

/**
 * 在 parent 里做一个假的 SpeakMore.app：程序是系统的 sleep 换了个名字。sign 为 true 时做临时签名（没有开发者），
 * 和装着的、下载的两边一样，开发者都是"没有"，比得上
 */
function fakeApp(parent, version, { sign = true, bundleId = "com.zephyrxiang.speakmore" } = {}) {
  const app = join(parent, "SpeakMore.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  copyFileSync("/bin/sleep", join(app, "Contents", "MacOS", "SpeakMore"));
  writeFileSync(
    join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>SpeakMore</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`,
  );
  if (sign) execFileSync("codesign", ["--sign", "-", "--force", "--deep", app], { stdio: "ignore" });
  return app;
}

/** 照发布的样子把一个 App 装进 dmg，放到 release/<version>/，配上校验值 */
function publishDmg(release, version, app) {
  const stage = mkdtempSync(join(dir, "stage-"));
  execFileSync("ditto", [app, join(stage, "SpeakMore.app")]);
  const folder = join(release, version);
  mkdirSync(folder, { recursive: true });
  const dmg = join(folder, `SpeakMore-${ARCH}.dmg`);
  execFileSync("hdiutil", [
    "create",
    "-quiet",
    "-volname",
    "SpeakMore",
    "-srcfolder",
    stage,
    "-format",
    "UDZO",
    "-ov",
    dmg,
  ]);
  const hash = createHash("sha256").update(readFileSync(dmg)).digest("hex");
  writeFileSync(`${dmg}.sha256`, `${hash}  SpeakMore-${ARCH}.dmg\n`);
  return dmg;
}

const versionOf = (app) =>
  execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleShortVersionString", join(app, "Contents", "Info.plist")],
    {
      encoding: "utf8",
    },
  ).trim();

test("找 App：SPEAKMORE_APP 指的那个；不是 SpeakMore（应用标识不对）、不存在的都当没装", macOnly, async () => {
  const mine = fakeApp(mkdtempSync(join(dir, "a-")), "0.3.0", { sign: false });
  const other = fakeApp(mkdtempSync(join(dir, "b-")), "1.0.0", { sign: false, bundleId: "com.example.other" });
  const find = (path) => createUpdater({ env: { ...process.env, SPEAKMORE_APP: path }, home: dir }).findApp(null);
  assert.deepEqual(await find(mine), { path: mine, version: "0.3.0" });
  assert.equal(await find(other), null);
  assert.equal(await find(join(dir, "nowhere", "SpeakMore.app")), null);
});

test("找 App：正在跑的那个在哪就是哪（按进程号找到它的应用包）", macOnly, async () => {
  // 要签上名：没签名的程序一运行就被系统以签名无效杀掉，还会留下一份崩溃报告
  const app = fakeApp(mkdtempSync(join(dir, "run-")), "0.4.0");
  const child = spawn(join(app, "Contents", "MacOS", "SpeakMore"), ["30"], { stdio: "ignore" });
  try {
    const { SPEAKMORE_APP: _ignored, ...env } = process.env;
    const found = await createUpdater({ env, home: dir }).findApp(child.pid);
    assert.deepEqual(found, { path: app, version: "0.4.0" });
  } finally {
    child.kill();
  }
});

test("换 App：下载对应芯片的 dmg、核对校验值和签名，换掉装着的那个，不留下半截的东西", {
  ...macOnly,
  timeout: 60_000,
}, async () => {
  const release = join(dir, "release");
  const applications = mkdtempSync(join(dir, "Applications-"));
  const installed = fakeApp(applications, "0.1.0");
  publishDmg(release, "v0.2.0", fakeApp(mkdtempSync(join(dir, "new-")), "0.2.0"));
  const updater = createUpdater({ env: { ...process.env, SPEAKMORE_INSTALL_BASE: release }, home: dir });

  await updater.installApp("v0.2.0", installed);
  assert.equal(versionOf(installed), "0.2.0");
  execFileSync("codesign", ["--verify", "--deep", "--strict", installed]);
  assert.deepEqual(readdirSync(applications), ["SpeakMore.app"]);

  // dmg 里的版本和要装的对不上：不装
  cpSync(join(release, "v0.2.0"), join(release, "v0.3.0"), { recursive: true });
  await assert.rejects(updater.installApp("v0.3.0", installed), (error) => {
    assert.ok(error instanceof LocalizedError);
    assert.match(zh.text(error.problem), /0\.3\.0/);
    return true;
  });
  assert.equal(versionOf(installed), "0.2.0");
  assert.deepEqual(readdirSync(applications), ["SpeakMore.app"]);
});

test("换 App：校验值对不上、没签名的，都不装，装着的原样留着", { ...macOnly, timeout: 60_000 }, async () => {
  const release = join(dir, "release");
  const applications = mkdtempSync(join(dir, "Applications-"));
  const installed = fakeApp(applications, "0.1.0");
  const updater = createUpdater({ env: { ...process.env, SPEAKMORE_INSTALL_BASE: release }, home: dir });

  const dmg = publishDmg(release, "v0.2.0", fakeApp(mkdtempSync(join(dir, "new-")), "0.2.0"));
  writeFileSync(`${dmg}.sha256`, `${"0".repeat(64)}  SpeakMore-${ARCH}.dmg\n`);
  await assert.rejects(updater.installApp("v0.2.0", installed), (error) => {
    assert.ok(error instanceof LocalizedError);
    assert.match(zh.text(error.problem), new RegExp(`SpeakMore-${ARCH}\\.dmg`));
    return true;
  });

  publishDmg(release, "v0.2.1", fakeApp(mkdtempSync(join(dir, "unsigned-")), "0.2.1", { sign: false }));
  await assert.rejects(updater.installApp("v0.2.1", installed), (error) => {
    assert.ok(error instanceof LocalizedError);
    assert.match(zh.text(error.problem), /签名/);
    return true;
  });

  assert.equal(versionOf(installed), "0.1.0");
  assert.deepEqual(readdirSync(applications), ["SpeakMore.app"]);
});

test("装完要不要启动：不要时给安装脚本带上 --no-start", macOnly, async () => {
  const release = join(dir, "release");
  const record = join(dir, "args");
  mkdirSync(release);
  writeFileSync(join(release, "install.sh"), `printf '%s' "$*" > ${JSON.stringify(record)}\n`);
  const updater = createUpdater({ env: { ...process.env, SPEAKMORE_INSTALL_BASE: release }, home: dir });
  assert.equal(await updater.install("v9.9.9", { start: false }), 0);
  assert.equal(readFileSync(record, "utf8"), "--no-start");
  assert.equal(await updater.install("v9.9.9"), 0);
  assert.equal(readFileSync(record, "utf8"), "");
});

test("打开 App：不把命令行自己的 ELECTRON_RUN_AS_NODE 带过去（带过去 App 会当成 Node 跑、一启动就退出）", {
  ...macOnly,
  timeout: 30_000,
}, async () => {
  // 假 App 的程序是一段脚本：把拿到的环境变量写进文件。应用标识另起一个，不和真的 SpeakMore 混在一起
  const app = join(mkdtempSync(join(dir, "open-")), "SpeakMoreOpenTest.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  const record = join(dir, "env");
  writeFileSync(
    join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.zephyrxiang.speakmore.open-test</string>
<key>CFBundleExecutable</key><string>run</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`,
  );
  writeFileSync(
    join(app, "Contents", "MacOS", "run"),
    `#!/bin/sh\nenv > ${JSON.stringify(`${record}.tmp`)}\nmv ${JSON.stringify(`${record}.tmp`)} ${JSON.stringify(record)}\n`,
    {
      mode: 0o755,
    },
  );
  const updater = createUpdater({
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SPEAKMORE_OPEN_TEST: "passed-through" },
    home: dir,
  });
  await updater.openApp(app);
  for (let waited = 0; !existsSync(record) && waited < 20_000; waited += 200) await delay(200);
  const seen = readFileSync(record, "utf8");
  assert.match(seen, /^SPEAKMORE_OPEN_TEST=passed-through$/m, "别的环境变量照样带过去（SPEAKMORE_HOME 这些）");
  assert.doesNotMatch(seen, /^ELECTRON_RUN_AS_NODE=/m);
});

test(
  "Windows：真的去问、真的跑 install.ps1（按 UTF-8 读进来再跑）；装哪、装哪个版本、要不要启动都走环境变量",
  windowsOnly,
  async () => {
    const release = join(dir, "release");
    const record = join(dir, "record");
    const home = join(dir, "home");
    mkdirSync(release);
    writeFileSync(join(release, "latest"), "v9.9.9\n");
    // 假的安装脚本：记下拿到的几个环境变量（带一句中文：要按 UTF-8 读才对得上），按要求的结果收尾
    writeFileSync(
      join(release, "install.ps1"),
      `& { Set-Content -Encoding UTF8 -Path $env:RECORD -Value "装好了|$($env:SPEAKMORE_HOME)|$($env:SPEAKMORE_VERSION)|$($env:SPEAKMORE_NO_START)"; $global:LASTEXITCODE = [int]$env:FAKE_EXIT }\n`,
    );
    const env = { ...process.env, SPEAKMORE_INSTALL_BASE: release, RECORD: record, FAKE_EXIT: "0" };
    const updater = createUpdater({ env, home });
    assert.equal(await updater.latest(5), "v9.9.9");
    assert.equal(await updater.install("v9.9.9"), 0);
    assert.equal(
      readFileSync(record, "utf8")
        .replace(/^\uFEFF/, "")
        .trim(),
      `装好了|${home}|v9.9.9|`,
    );
    assert.equal(await updater.install("v9.9.9", { start: false }), 0);
    assert.equal(
      readFileSync(record, "utf8")
        .replace(/^\uFEFF/, "")
        .trim(),
      `装好了|${home}|v9.9.9|1`,
    );
    const failing = createUpdater({ env: { ...env, FAKE_EXIT: "1" }, home });
    assert.equal(await failing.install("v9.9.9"), 1);
  },
);
