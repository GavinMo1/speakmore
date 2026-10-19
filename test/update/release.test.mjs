import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import { createTranslator, LocalizedError } from "../../src/i18n/index.mjs";
import { createRelease, DOWNLOAD_URL, downloadBase } from "../../src/update/release.mjs";
import { compareVersions, parseVersion } from "../../src/update/versions.mjs";

const zh = createTranslator("zh-CN");

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-release-"));
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

test("认版本号：带不带 v、前后的空白都认；不像版本号的（报错的网页、空的）是 null", () => {
  assert.equal(parseVersion("v0.10.1"), "0.10.1");
  assert.equal(parseVersion(" 0.10.1-rc.2\n"), "0.10.1-rc.2");
  for (const bad of ["<html>", "", null, undefined, "v1.2", "latest"])
    assert.equal(parseVersion(bad), null, String(bad));
});

test("从哪下载：和安装脚本一样，默认是发布的地址，SPEAKMORE_INSTALL_BASE 可以换成网址或者本机的目录", () => {
  assert.equal(downloadBase({}), DOWNLOAD_URL);
  assert.equal(downloadBase({ SPEAKMORE_INSTALL_BASE: "https://example.com/sm" }), "https://example.com/sm");
  assert.equal(downloadBase({ SPEAKMORE_INSTALL_BASE: "/tmp/release" }), "file:///tmp/release");
  assert.equal(downloadBase({ SPEAKMORE_INSTALL_BASE: "C:\\dist\\release" }), "file:///C:/dist/release");
});

test("真的去问、真的下载：用本机的一个目录当下载地址；包和校验值对得上才算下好", async () => {
  const release = join(dir, "release");
  mkdirSync(join(release, "v9.9.9"), { recursive: true });
  writeFileSync(join(release, "latest"), "v9.9.9\n");
  writeFileSync(join(release, "install.sh"), "echo hi\n");
  writeFileSync(join(release, "v9.9.9", "pkg.zip"), "包");
  // "包" 的 UTF-8 的 sha256
  writeFileSync(
    join(release, "v9.9.9", "pkg.zip.sha256"),
    "e8e0f9cbc0e2b47f3a3e3a0e0e1cbf1eac7c7de7e1e5e4d6b5d9b1d8b8a8f1c0  pkg.zip\n",
  );
  const server = createRelease({ env: { ...process.env, SPEAKMORE_INSTALL_BASE: release } });
  assert.equal(await server.latest(5), "v9.9.9");
  await server.fetch("install.sh", join(dir, "install.sh"));

  // 校验值对不上：说是哪个文件
  await assert.rejects(server.fetchVerified("v9.9.9/pkg.zip", join(dir, "pkg.zip")), (error) => {
    assert.ok(error instanceof LocalizedError);
    assert.match(zh.text(error.problem), /下载的 pkg\.zip 与发布的校验值不符/);
    return true;
  });
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update("包").digest("hex");
  writeFileSync(join(release, "v9.9.9", "pkg.zip.sha256"), `${hash}  pkg.zip\n`);
  await server.fetchVerified("v9.9.9/pkg.zip", join(dir, "pkg.zip"));
  assert.equal(server.url("v9.9.9/pkg.zip"), `file://${release}/v9.9.9/pkg.zip`);
});

test("下载地址问不到：报出地址和 curl 说的原因", async () => {
  const server = createRelease({ env: { ...process.env, SPEAKMORE_INSTALL_BASE: join(dir, "nowhere") } });
  for (const attempt of [() => server.latest(5), () => server.fetch("install.sh", join(dir, "x"))]) {
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
