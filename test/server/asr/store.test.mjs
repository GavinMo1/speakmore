import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createModelStore, hfMirror, huggingFace } from "../../../src/server/asr/store.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const BYTES = { "a.onnx": Buffer.from("weights ".repeat(1000)), "tokenizer/vocab.json": Buffer.from('{"a":1}') };
const fileOf = (path) => ({ path, size: BYTES[path].length, sha256: sha256(BYTES[path]) });
const MODEL = {
  id: "fake-asr",
  source: { repo: "someone/fake-asr", revision: "a".repeat(40) },
  files: { model: fileOf("a.onnx"), vocab: fileOf("tokenizer/vocab.json") },
};

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 一个临时的仓，下载走假的 fetch：按地址最后的路径给内容，记下下了哪些 */
function setUp({ serve = (path) => new Response(BYTES[path]) } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "speakmore-models-"));
  dirs.push(dir);
  const fetched = [];
  const fetch = async (url) => {
    const path = url.split(`/resolve/${MODEL.source.revision}/`)[1];
    fetched.push(path);
    return serve(path);
  };
  return { dir, fetched, store: createModelStore({ dir, fetch }) };
}

test("下载地址是 Hugging Face 上钉在那次提交的文件", () => {
  assert.equal(
    huggingFace(MODEL, MODEL.files.vocab),
    `https://huggingface.co/someone/fake-asr/resolve/${"a".repeat(40)}/tokenizer/vocab.json`,
  );
});

test("镜像的地址和 Hugging Face 的一样排，只换主机", () => {
  assert.equal(
    hfMirror(MODEL, MODEL.files.vocab),
    `https://hf-mirror.com/someone/fake-asr/resolve/${"a".repeat(40)}/tokenizer/vocab.json`,
  );
});

test("第一个地址连不上、回错误码：换下一个接着下，都不行才报错，报错里列出每个地址的原因", async () => {
  const dir = mkdtempSync(join(tmpdir(), "speakmore-models-"));
  dirs.push(dir);
  const hosts = [];
  const fetch = async (url) => {
    const { host, pathname } = new URL(url);
    hosts.push(host);
    if (host === "huggingface.co") throw new TypeError("fetch failed");
    return new Response(BYTES[pathname.split(`/resolve/${MODEL.source.revision}/`)[1]]);
  };
  const store = createModelStore({ dir, fetch });
  await store.install(MODEL);
  assert.equal(store.isInstalled(MODEL), true);
  assert.deepEqual(hosts, ["huggingface.co", "hf-mirror.com", "huggingface.co", "hf-mirror.com"]);

  const failing = createModelStore({
    dir: mkdtempSync(join(tmpdir(), "speakmore-models-")),
    fetch: async (url) =>
      new URL(url).host === "huggingface.co"
        ? Promise.reject(new TypeError("fetch failed"))
        : new Response("", { status: 503 }),
  });
  await assert.rejects(
    failing.install(MODEL),
    (error) => /huggingface\.co.*fetch failed/s.test(error.message) && /hf-mirror\.com.*HTTP 503/s.test(error.message),
  );
});

test("连上了但迟迟不给数据：到时候放弃这个地址，换下一个", async () => {
  const dir = mkdtempSync(join(tmpdir(), "speakmore-models-"));
  dirs.push(dir);
  const fetch = async (url, { signal }) => {
    const { host, pathname } = new URL(url);
    if (host === "huggingface.co") {
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    }
    return new Response(BYTES[pathname.split(`/resolve/${MODEL.source.revision}/`)[1]]);
  };
  const store = createModelStore({ dir, fetch, stallMs: 50 });
  await store.install(MODEL);
  assert.equal(store.isInstalled(MODEL), true);
});

test("装一个模型：文件照清单的路径放好，校验过，写上收据；再装一次不重新下载", async () => {
  const { dir, fetched, store } = setUp();
  const progress = [];
  assert.equal(store.isInstalled(MODEL), false);
  const modelDir = await store.install(MODEL, { onProgress: (p) => progress.push(p) });
  assert.equal(modelDir, join(dir, "fake-asr"));
  assert.deepEqual(readFileSync(join(modelDir, "tokenizer/vocab.json")), BYTES["tokenizer/vocab.json"]);
  assert.deepEqual(readFileSync(join(modelDir, "a.onnx")), BYTES["a.onnx"]);
  assert.equal(store.isInstalled(MODEL), true);
  assert.deepEqual(store.installed(), ["fake-asr"]);
  assert.deepEqual(progress.at(-1), { file: "tokenizer/vocab.json", received: 7, total: 7 });

  await store.install(MODEL);
  assert.deepEqual(fetched, ["a.onnx", "tokenizer/vocab.json"]);
});

test("内容和 sha256 对不上：报错说清是哪个文件，不留半截文件，也不算装好", async () => {
  const { dir, store } = setUp({ serve: (path) => new Response(path === "a.onnx" ? "tampered" : BYTES[path]) });
  await assert.rejects(store.install(MODEL), /a\.onnx 下载到 8 字节/);
  assert.equal(store.isInstalled(MODEL), false);
  assert.deepEqual(readdirSync(join(dir, "fake-asr")), []);
});

test("大小对但内容不对：报 sha256 对不上", async () => {
  const forged = Buffer.alloc(BYTES["a.onnx"].length, 1);
  const { store } = setUp({ serve: (path) => new Response(path === "a.onnx" ? forged : BYTES[path]) });
  await assert.rejects(store.install(MODEL), /a\.onnx 的 sha256 对不上/);
});

test("服务器回错误码：报出状态码，不当成下载成功", async () => {
  const { store } = setUp({ serve: () => new Response("nope", { status: 404 }) });
  await assert.rejects(store.install(MODEL), /HTTP 404/);
  assert.equal(store.isInstalled(MODEL), false);
});

test("断了重来：已经下好、内容也对的文件不再下载，只补缺的", async () => {
  const { dir, fetched, store } = setUp();
  mkdirSync(join(dir, "fake-asr"), { recursive: true });
  writeFileSync(join(dir, "fake-asr", "a.onnx"), BYTES["a.onnx"]);
  await store.install(MODEL);
  assert.deepEqual(fetched, ["tokenizer/vocab.json"]);
  assert.equal(store.isInstalled(MODEL), true);
});

test("已经在那儿的文件内容不对（下坏了、被改过）：重新下载，不拿来用", async () => {
  const { dir, fetched, store } = setUp();
  mkdirSync(join(dir, "fake-asr"), { recursive: true });
  writeFileSync(join(dir, "fake-asr", "a.onnx"), "stale");
  await store.install(MODEL);
  assert.deepEqual(fetched, ["a.onnx", "tokenizer/vocab.json"]);
  assert.deepEqual(readFileSync(join(dir, "fake-asr", "a.onnx")), BYTES["a.onnx"]);
});

test("清单换了版本，旧收据就不算数：重新核对文件，内容没变的不重下", async () => {
  const { fetched, store } = setUp();
  await store.install(MODEL);
  const moved = { ...MODEL, source: { ...MODEL.source, revision: "b".repeat(40) } };
  assert.equal(store.isInstalled(moved), false);
  await createModelStore({
    dir: store.dirOf(MODEL).replace(/\/fake-asr$/, ""),
    fetch: () => assert.fail("不该下载"),
  }).install(moved);
  assert.equal(store.isInstalled(moved), true);
  assert.equal(fetched.length, 2);
});

test("删掉：整个目录都不在了，列表里也没有；没装过的删了也不报错", async () => {
  const { store } = setUp();
  await store.install(MODEL);
  store.remove(MODEL);
  assert.equal(existsSync(store.dirOf(MODEL)), false);
  assert.deepEqual(store.installed(), []);
  store.remove(MODEL);
});
