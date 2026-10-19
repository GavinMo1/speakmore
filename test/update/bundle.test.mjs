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
import { createTranslator, LocalizedError } from "../../src/i18n/index.mjs";
import { bundleOfPackage, createBundles } from "../../src/update/bundle.mjs";
import { createRelease } from "../../src/update/release.mjs";

const zh = createTranslator("zh-CN");

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-up-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// SpeakMore.app 只有 macOS 上有：要用系统的 hdiutil、codesign、ditto
const macOnly = { skip: process.platform !== "darwin" && "macOS 的 SpeakMore.app" };

/** 照这个下载地址找 App、换 App 的那一套 */
const bundlesFrom = (env) => createBundles({ env, release: createRelease({ env }) });

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
  const find = (path) => bundlesFrom({ ...process.env, SPEAKMORE_APP: path }).find();
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
    const found = await bundlesFrom(env).find({ pid: child.pid });
    assert.deepEqual(found, { path: app, version: "0.4.0" });
  } finally {
    child.kill();
  }
});

test("换 App：先下好对应芯片的 dmg、核对校验值和签名、拷到旁边（装着的这时不动），换上之后不留下半截的东西", {
  ...macOnly,
  timeout: 60_000,
}, async () => {
  const release = join(dir, "release");
  const applications = mkdtempSync(join(dir, "Applications-"));
  const installed = fakeApp(applications, "0.1.0");
  publishDmg(release, "v0.2.0", fakeApp(mkdtempSync(join(dir, "new-")), "0.2.0"));
  const bundles = bundlesFrom({ ...process.env, SPEAKMORE_INSTALL_BASE: release });

  const staged = await bundles.stage("0.2.0", installed);
  // 下好了还没换：装着的照旧，新的藏在旁边（名字带点开头，访达里看不见）
  assert.equal(versionOf(installed), "0.1.0");
  assert.deepEqual(readdirSync(applications).sort(), [".SpeakMore.app.new", "SpeakMore.app"]);
  staged.commit();
  assert.equal(versionOf(installed), "0.2.0");
  execFileSync("codesign", ["--verify", "--deep", "--strict", installed]);
  assert.deepEqual(readdirSync(applications), ["SpeakMore.app"]);

  // 不换了：待换的删掉，装着的不动
  publishDmg(release, "v0.2.1", fakeApp(mkdtempSync(join(dir, "newer-")), "0.2.1"));
  (await bundles.stage("0.2.1", installed)).discard();
  assert.equal(versionOf(installed), "0.2.0");
  assert.deepEqual(readdirSync(applications), ["SpeakMore.app"]);

  // dmg 里的版本和要装的对不上：不装
  cpSync(join(release, "v0.2.0"), join(release, "v0.3.0"), { recursive: true });
  await assert.rejects(bundles.stage("0.3.0", installed), (error) => {
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
  const bundles = bundlesFrom({ ...process.env, SPEAKMORE_INSTALL_BASE: release });

  const dmg = publishDmg(release, "v0.2.0", fakeApp(mkdtempSync(join(dir, "new-")), "0.2.0"));
  writeFileSync(`${dmg}.sha256`, `${"0".repeat(64)}  SpeakMore-${ARCH}.dmg\n`);
  await assert.rejects(bundles.stage("0.2.0", installed), (error) => {
    assert.ok(error instanceof LocalizedError);
    assert.match(zh.text(error.problem), new RegExp(`SpeakMore-${ARCH}\\.dmg`));
    return true;
  });

  publishDmg(release, "v0.2.1", fakeApp(mkdtempSync(join(dir, "unsigned-")), "0.2.1", { sign: false }));
  await assert.rejects(bundles.stage("0.2.1", installed), (error) => {
    assert.ok(error instanceof LocalizedError);
    assert.match(zh.text(error.problem), /签名/);
    return true;
  });

  assert.equal(versionOf(installed), "0.1.0");
  assert.deepEqual(readdirSync(applications), ["SpeakMore.app"]);
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
  const bundles = bundlesFrom({ ...process.env, ELECTRON_RUN_AS_NODE: "1", SPEAKMORE_OPEN_TEST: "passed-through" });
  await bundles.open(app);
  for (let waited = 0; !existsSync(record) && waited < 20_000; waited += 200) await delay(200);
  const seen = readFileSync(record, "utf8");
  assert.match(seen, /^SPEAKMORE_OPEN_TEST=passed-through$/m, "别的环境变量照样带过去（SPEAKMORE_HOME 这些）");
  assert.doesNotMatch(seen, /^ELECTRON_RUN_AS_NODE=/m);
});

test("这份程序在哪个应用包里：…/X.app/Contents/Resources/app 才算，别的（源码目录、家目录里的）不算", () => {
  assert.equal(bundleOfPackage("/Applications/SpeakMore.app/Contents/Resources/app"), "/Applications/SpeakMore.app");
  assert.equal(
    bundleOfPackage("/Users/a/My Apps/SpeakMore.app/Contents/Resources/app/"),
    "/Users/a/My Apps/SpeakMore.app",
  );
  assert.equal(bundleOfPackage("/Users/a/.speakmore/app"), null);
  assert.equal(bundleOfPackage("/Users/a/code/speakmore"), null);
});

test("不是 macOS 就没有应用包", async () => {
  const bundles = createBundles({ env: {}, release: createRelease({ env: {} }), platform: "win32" });
  assert.equal(await bundles.find({ pid: 1 }), null);
});
