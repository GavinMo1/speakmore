import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { compareVersions } from "../../src/cli/commands/update.mjs";
import { createUpdater, DOWNLOAD_URL, downloadBase } from "../../src/cli/updater.mjs";
import { createTranslator, LocalizedError } from "../../src/i18n/index.mjs";

const zh = createTranslator("zh-CN");

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-up-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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
});

test("真的去问、真的跑安装脚本：用本机的一个目录当下载地址", async () => {
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
      assert.ok(said.includes(join(dir, "nowhere")), said);
      assert.match(said, /curl/);
      return true;
    });
  }
});
