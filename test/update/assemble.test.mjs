import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { assembleTree, indexSeeds } from "../../src/update/assemble.mjs";
import { sha256 } from "../../src/update/chunker.mjs";
import { describeTree, encodeManifest, parseManifest } from "../../src/update/manifest.mjs";
import { packObject, unpackObject } from "../../src/update/objects.mjs";

const posix = { skip: process.platform === "win32" && "符号链接和可执行位只在 macOS 上有" };

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-assemble-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 固定种子的伪随机内容 */
function pseudoRandom(size, seed) {
  const data = Buffer.alloc(size);
  let x = seed;
  for (let i = 0; i < size; i += 1) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    data[i] = x >>> 24;
  }
  return data;
}

/** 摆一棵像程序的树：一个大的二进制、几个小文件、一个可执行文件、一个空目录、一个符号链接（不在 Windows 上） */
function makeTree(root, { big = pseudoRandom(3 * 1024 * 1024, 11), version = "1.0.0" } = {}) {
  mkdirSync(join(root, "app", "src"), { recursive: true });
  mkdirSync(join(root, "runtime", "Frameworks", "Versions", "A"), { recursive: true });
  mkdirSync(join(root, "app", "empty"), { recursive: true });
  writeFileSync(join(root, "runtime", "Frameworks", "Versions", "A", "Engine"), big);
  writeFileSync(join(root, "app", "package.json"), JSON.stringify({ version }));
  writeFileSync(join(root, "app", "src", "main.mjs"), `console.log("${version}");\n`);
  writeFileSync(join(root, "app", "src", "empty.txt"), "");
  writeFileSync(join(root, "runtime", "launch"), "#!/bin/sh\necho hi\n");
  chmodSync(join(root, "runtime", "launch"), 0o755);
  if (process.platform !== "win32") symlinkSync("A", join(root, "runtime", "Frameworks", "Versions", "Current"));
  return root;
}

/** 一个放在本机目录里的对象仓：按 sha256 存压过的块和清单，取的时候数一数取了哪些 */
function makeStore() {
  const storeDir = join(dir, "store");
  mkdirSync(storeDir, { recursive: true });
  const fetched = [];
  return {
    dir: storeDir,
    fetched,
    put(sha, data) {
      writeFileSync(join(storeDir, sha), packObject(data));
    },
    /** 照 assemble.mjs 要的样子：把这些对象（压着的）放进 into 目录，名字就是 sha256 */
    async fetchObjects(shas, into, onBytes) {
      for (const sha of shas) {
        fetched.push(sha);
        const packed = readFileSync(join(storeDir, sha));
        writeFileSync(join(into, sha), packed);
        onBytes?.(packed.length);
      }
    },
  };
}

/** 发布一棵树：切块进仓，清单也进仓，交回清单（解析过的，和更新时拿到的一样） */
async function publishTree(root, store) {
  const manifest = await describeTree(root, { put: store.put });
  const encoded = encodeManifest(manifest);
  return parseManifest(encoded);
}

/** 树里每样东西：路径、类型、内容（文件）或指向（链接）、可执行位 */
function snapshot(root) {
  const out = [];
  const visit = (rel) => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const path = rel ? `${rel}/${name}` : name;
      const full = join(root, path);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) out.push([path, "link", readlinkSync(full)]);
      else if (stat.isDirectory()) {
        out.push([path, "dir"]);
        visit(path);
      } else {
        const exec = process.platform === "win32" ? null : (stat.mode & 0o111) !== 0;
        out.push([path, "file", readFileSync(full).toString("base64"), exec]);
      }
    }
  };
  visit("");
  return out;
}

test("从空的本机拼一棵树：文件内容、空文件、空目录、可执行位、符号链接都和发布的一模一样", async () => {
  const source = makeTree(join(dir, "v1"));
  const store = makeStore();
  const manifest = await publishTree(source, store);
  const dest = join(dir, "out");
  const result = await assembleTree({
    manifest,
    dest,
    seeds: [],
    fetchObjects: store.fetchObjects,
    cacheDir: join(dir, "cache"),
  });
  assert.deepEqual(snapshot(dest), snapshot(source));
  assert.ok(result.downloadedChunks > 0);
  assert.equal(result.reusedBytes, 0);
});

test("本机装着上一版：只下变了的块，没变的从本机那份拷", async () => {
  const big = pseudoRandom(3 * 1024 * 1024, 11);
  const old = makeTree(join(dir, "v1"), { big, version: "1.0.0" });
  // 新版本：大文件末尾改了一点（像重新签名），代码改了
  const edited = Buffer.concat([big.subarray(0, big.length - 4000), pseudoRandom(5000, 99)]);
  const fresh = makeTree(join(dir, "v2"), { big: edited, version: "1.0.1" });
  const store = makeStore();
  const manifest = await publishTree(fresh, store);
  const dest = join(dir, "out");
  const result = await assembleTree({
    manifest,
    dest,
    seeds: [old],
    fetchObjects: store.fetchObjects,
    cacheDir: join(dir, "cache"),
  });
  assert.deepEqual(snapshot(dest), snapshot(fresh));
  // 大文件只下了末尾那一两块，大部分是从本机拷的
  assert.ok(result.downloadedBytes < 1024 * 1024, `下了 ${result.downloadedBytes} 字节`);
  assert.ok(result.reusedBytes > 2 * 1024 * 1024, `拷了 ${result.reusedBytes} 字节`);
});

test("种子在切完以后被改了：那一块对不上就改从仓里取，拼出来的照样对", async () => {
  const old = makeTree(join(dir, "v1"));
  const fresh = makeTree(join(dir, "v2"), { version: "2.0.0" });
  const store = makeStore();
  const manifest = await publishTree(fresh, store);
  const seedIndex = await indexSeeds([old], manifest);
  writeFileSync(join(old, "runtime", "Frameworks", "Versions", "A", "Engine"), pseudoRandom(3 * 1024 * 1024, 12));
  const dest = join(dir, "out");
  await assembleTree({ manifest, dest, seedIndex, fetchObjects: store.fetchObjects, cacheDir: join(dir, "cache") });
  assert.deepEqual(snapshot(dest), snapshot(fresh));
});

test("取到的块内容不对（被改过、坏了）：报出是哪一块，不拿来拼", async () => {
  const source = makeTree(join(dir, "v1"));
  const store = makeStore();
  const manifest = await publishTree(source, store);
  const [victim] = readdirSync(store.dir);
  writeFileSync(join(store.dir, victim), packObject(Buffer.from("tampered")));
  await assert.rejects(
    assembleTree({
      manifest,
      dest: join(dir, "out"),
      seeds: [],
      fetchObjects: store.fetchObjects,
      cacheDir: join(dir, "cache"),
    }),
    new RegExp(`update data \\(${victim.slice(0, 12)}\\) doesn't match`),
  );
});

test("下到一半断了：已经取到的块留在缓存里，再来一次只取剩下的", async () => {
  const source = makeTree(join(dir, "v1"));
  const store = makeStore();
  const manifest = await publishTree(source, store);
  const cacheDir = join(dir, "cache");
  let budget = 2;
  const flaky = async (shas, into, onBytes) => {
    for (const sha of shas) {
      if (budget-- <= 0) throw new Error("断网了");
      await store.fetchObjects([sha], into, onBytes);
    }
  };
  await assert.rejects(
    assembleTree({ manifest, dest: join(dir, "out1"), seeds: [], fetchObjects: flaky, cacheDir }),
    /断网了/,
  );
  const firstRound = store.fetched.length;
  assert.equal(firstRound, 2);
  await assembleTree({ manifest, dest: join(dir, "out2"), seeds: [], fetchObjects: store.fetchObjects, cacheDir });
  const secondRound = store.fetched.slice(firstRound);
  assert.equal(new Set([...store.fetched]).size, store.fetched.length, "同一块取了两次");
  assert.ok(secondRound.length > 0);
  assert.deepEqual(snapshot(join(dir, "out2")), snapshot(source));
});

test("拼到的目录已经有东西：不往里写，免得混进别的文件", async () => {
  const source = makeTree(join(dir, "v1"));
  const store = makeStore();
  const manifest = await publishTree(source, store);
  const dest = join(dir, "out");
  mkdirSync(dest);
  writeFileSync(join(dest, "stray"), "x");
  await assert.rejects(
    assembleTree({ manifest, dest, seeds: [], fetchObjects: store.fetchObjects, cacheDir: join(dir, "cache") }),
    /不是空的/,
  );
});

test("清单：越出目录的路径、绝对路径、反斜杠、指到外面的链接、重复的路径、不认识的切法都拒收", async () => {
  const good = { format: 1, chunking: "fastcdc-gear32-v1", entries: [{ path: "a", type: "dir" }] };
  const sha = "a".repeat(64);
  const bad = [
    { path: "../x", type: "dir" },
    { path: "/etc/x", type: "dir" },
    { path: "a\\b", type: "dir" },
    { path: "a//b", type: "dir" },
    { path: "l", type: "link", target: "../../etc" },
    { path: "l", type: "link", target: "/etc" },
    { path: "f", type: "file", exec: false, chunks: [["xyz", 1]] },
    { path: "f", type: "file", exec: false, chunks: [[sha, -1]] },
    { path: "f", type: "pipe" },
  ];
  assert.deepEqual(parseManifest(Buffer.from(JSON.stringify(good))).entries, good.entries);
  for (const entry of bad) {
    assert.throws(
      () => parseManifest(Buffer.from(JSON.stringify({ ...good, entries: [entry] }))),
      /路径不对|指到了目录外面|的块不对|类型不认识/,
      JSON.stringify(entry),
    );
  }
  assert.throws(
    () => parseManifest(Buffer.from(JSON.stringify({ ...good, entries: [good.entries[0], good.entries[0]] }))),
    /重复/,
  );
  assert.throws(() => parseManifest(Buffer.from(JSON.stringify({ ...good, chunking: "other" }))), /切法/);
  assert.throws(() => parseManifest(Buffer.from(JSON.stringify({ ...good, format: 2 }))), /格式/);
});

test("对象：压过再解开原样回来；sha256 对不上的拒收", () => {
  const data = pseudoRandom(200_000, 5);
  const packed = packObject(data);
  assert.ok(packed.length < data.length + 100);
  assert.deepEqual(unpackObject(packed, sha256(data)), data);
  assert.throws(() => unpackObject(packed, "b".repeat(64)), /sha256/);
  assert.throws(() => unpackObject(Buffer.from("not zstd"), sha256(data)), /解不开/);
});

test("可执行位：清单记着，拼出来的照样能执行", posix, async () => {
  const source = makeTree(join(dir, "v1"));
  const store = makeStore();
  const manifest = await publishTree(source, store);
  assert.equal(manifest.entries.find((entry) => entry.path === "runtime/launch").exec, true);
  assert.equal(manifest.entries.find((entry) => entry.path === "app/package.json").exec, false);
  const dest = join(dir, "out");
  await assembleTree({ manifest, dest, seeds: [], fetchObjects: store.fetchObjects, cacheDir: join(dir, "cache") });
  assert.ok(statSync(join(dest, "runtime", "launch")).mode & 0o100);
  assert.ok(existsSync(join(dest, "runtime", "Frameworks", "Versions", "Current", "Engine")));
});
