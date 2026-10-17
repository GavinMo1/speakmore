import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  ARCHS,
  archiveName,
  dmgName,
  planUpload,
  publish,
  sha256,
  WINDOWS_ARCHIVE,
  WINDOWS_SETUP,
} from "../../../scripts/release/release-layout.mjs";

let dir;

/** 摆一个假的发布目录：包是几个字节的假货，其余和真的一样 */
function makeRelease(version = "1.2.3") {
  mkdirSync(join(dir, `v${version}`), { recursive: true });
  for (const name of [...ARCHS.flatMap((arch) => [archiveName(arch), dmgName(arch)]), WINDOWS_ARCHIVE, WINDOWS_SETUP]) {
    const file = join(dir, `v${version}`, name);
    writeFileSync(file, `假的 ${name} ${version}`);
    writeFileSync(`${file}.sha256`, `${sha256(file)}  ${name}\n`);
  }
  writeFileSync(join(dir, "install.sh"), "#!/bin/bash\n");
  writeFileSync(join(dir, "install.ps1"), "& { }\n");
  writeFileSync(join(dir, "latest"), `v${version}\n`);
}

/** 假的桶：记着每个对象的大小、校验值和传的先后 */
function fakeStore(initial = {}) {
  const objects = new Map(Object.entries(initial));
  const puts = [];
  return {
    objects,
    puts,
    head: async (key) => objects.get(key) ?? null,
    put: async (item) => {
      puts.push(item.key);
      objects.set(item.key, { size: item.size, sha256: item.sha256 });
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-release-"));
  makeRelease();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("清单：先是这个版本的包、安装包和校验值（Mac 两种芯片、Windows），再是两个安装脚本，latest 排最后", () => {
  const items = planUpload(dir);
  assert.deepEqual(
    items.map((item) => item.key),
    [
      "speakmore/v1.2.3/speakmore-darwin-arm64.tar.gz",
      "speakmore/v1.2.3/speakmore-darwin-arm64.tar.gz.sha256",
      "speakmore/v1.2.3/SpeakMore-arm64.dmg",
      "speakmore/v1.2.3/SpeakMore-arm64.dmg.sha256",
      "speakmore/v1.2.3/speakmore-darwin-x64.tar.gz",
      "speakmore/v1.2.3/speakmore-darwin-x64.tar.gz.sha256",
      "speakmore/v1.2.3/SpeakMore-x64.dmg",
      "speakmore/v1.2.3/SpeakMore-x64.dmg.sha256",
      "speakmore/v1.2.3/speakmore-win32-x64.zip",
      "speakmore/v1.2.3/speakmore-win32-x64.zip.sha256",
      "speakmore/v1.2.3/SpeakMore-Setup-x64.exe",
      "speakmore/v1.2.3/SpeakMore-Setup-x64.exe.sha256",
      "speakmore/install.sh",
      "speakmore/install.ps1",
      "speakmore/latest",
    ],
  );
  // 浏览器拿到 dmg 要认得出是磁盘映像；install.ps1 要按 UTF-8 解（irm 照 charset 解，里面有中文注释）
  assert.equal(items[2].contentType, "application/x-apple-diskimage");
  assert.equal(items.find(({ key }) => key.endsWith("install.ps1")).contentType, "text/plain; charset=utf-8");
  // 浏览器下回来的 exe 要当成程序，不能当成网页里的文字打开
  assert.equal(
    items.find(({ key }) => key.endsWith(".exe")).contentType,
    "application/vnd.microsoft.portable-executable",
  );
});

test("清单：版本目录里的长期缓存、不许改；安装脚本和 latest 只缓存一小会儿", () => {
  const items = planUpload(dir);
  for (const item of items.slice(0, 12)) {
    assert.equal(item.immutable, true, item.key);
    assert.match(item.cacheControl, /immutable/);
  }
  for (const item of items.slice(12)) {
    assert.equal(item.immutable, false, item.key);
    assert.equal(item.cacheControl, "public, max-age=60");
  }
});

test("发布目录不齐或对不上：不出清单", () => {
  rmSync(join(dir, "v1.2.3", archiveName("x64")));
  assert.throws(() => planUpload(dir), /少了 v1\.2\.3\/speakmore-darwin-x64\.tar\.gz/);

  makeRelease();
  writeFileSync(join(dir, "v1.2.3", archiveName("arm64")), "打包之后被改过");
  assert.throws(() => planUpload(dir), /speakmore-darwin-arm64\.tar\.gz 和它的 \.sha256 对不上/);

  makeRelease();
  rmSync(join(dir, "v1.2.3", dmgName("arm64")));
  assert.throws(() => planUpload(dir), /少了 v1\.2\.3\/SpeakMore-arm64\.dmg/);

  makeRelease();
  writeFileSync(join(dir, "v1.2.3", dmgName("x64")), "签完名又改过");
  assert.throws(() => planUpload(dir), /SpeakMore-x64\.dmg 和它的 \.sha256 对不上/);

  makeRelease();
  writeFileSync(join(dir, "latest"), "最新的\n");
  assert.throws(() => planUpload(dir), /latest 不像版本号/);

  rmSync(join(dir, "latest"));
  assert.throws(() => planUpload(dir), /少了 latest/);
});

test("上传：全新的全传，按清单的先后；再来一次什么都不用传", async () => {
  const items = planUpload(dir);
  const store = fakeStore();
  const lines = [];
  await publish(items, store, (line) => lines.push(line));
  assert.deepEqual(
    store.puts,
    items.map((item) => item.key),
  );

  store.puts.length = 0;
  await publish(items, store, () => {});
  assert.deepEqual(store.puts, []);
});

test("上传：发新版本时旧版本的不碰，安装脚本和 latest 换成新的", async () => {
  const store = fakeStore();
  await publish(planUpload(dir), store, () => {});
  const old = store.objects.get("speakmore/v1.2.3/speakmore-darwin-arm64.tar.gz");

  rmSync(dir, { recursive: true });
  mkdirSync(dir);
  makeRelease("1.3.0");
  store.puts.length = 0;
  await publish(planUpload(dir), store, () => {});
  // 安装脚本没变所以不用传；latest 变了，排在包后面
  assert.deepEqual(store.puts, [
    "speakmore/v1.3.0/speakmore-darwin-arm64.tar.gz",
    "speakmore/v1.3.0/speakmore-darwin-arm64.tar.gz.sha256",
    "speakmore/v1.3.0/SpeakMore-arm64.dmg",
    "speakmore/v1.3.0/SpeakMore-arm64.dmg.sha256",
    "speakmore/v1.3.0/speakmore-darwin-x64.tar.gz",
    "speakmore/v1.3.0/speakmore-darwin-x64.tar.gz.sha256",
    "speakmore/v1.3.0/SpeakMore-x64.dmg",
    "speakmore/v1.3.0/SpeakMore-x64.dmg.sha256",
    "speakmore/v1.3.0/speakmore-win32-x64.zip",
    "speakmore/v1.3.0/speakmore-win32-x64.zip.sha256",
    "speakmore/v1.3.0/SpeakMore-Setup-x64.exe",
    "speakmore/v1.3.0/SpeakMore-Setup-x64.exe.sha256",
    "speakmore/latest",
  ]);
  assert.deepEqual(store.objects.get("speakmore/v1.2.3/speakmore-darwin-arm64.tar.gz"), old);
});

test("上传：同一个版本号已经发布过、内容不一样：不覆盖，latest 也不动", async () => {
  const store = fakeStore();
  await publish(planUpload(dir), store, () => {});

  writeFileSync(join(dir, "v1.2.3", archiveName("arm64")), "同一个版本号，重新打的");
  writeFileSync(
    join(dir, "v1.2.3", `${archiveName("arm64")}.sha256`),
    `${sha256(join(dir, "v1.2.3", archiveName("arm64")))}  x\n`,
  );
  store.puts.length = 0;
  await assert.rejects(
    publish(planUpload(dir), store, () => {}),
    /已经发布过，内容和这次的不一样/,
  );
  assert.deepEqual(store.puts, []);
});

test("上传：传上去之后对不上（大小或校验值）：报错，不接着往下传", async () => {
  const store = fakeStore();
  store.put = async (item) => {
    store.puts.push(item.key);
    store.objects.set(item.key, { size: item.size - 1, sha256: item.sha256 });
  };
  await assert.rejects(
    publish(planUpload(dir), store, () => {}),
    /传上去之后和本机的对不上/,
  );
  assert.equal(store.puts.length, 1);
});
