import assert from "node:assert/strict";
import { test } from "node:test";
import { findModel } from "../../../src/models/catalog.mjs";
import { startTranscriber } from "../../../src/server/asr/start.mjs";

const quiet = { info() {}, warn() {}, error() {} };
const MODEL = findModel("qwen3-asr-0.6b-q8");

/** 假的模型仓：installed 决定装没装；有人让它下载就记下来（不该有） */
function fakeStore(installed) {
  const calls = [];
  return {
    calls,
    isInstalled: () => installed,
    dirOf: (model) => `/models/${model.id}`,
    async install(model) {
      calls.push(model.id);
    },
  };
}

const fakeSpawn = async (request) => ({ request });

test("下载好了的：在转写进程里装上", async () => {
  const store = fakeStore(true);
  const { request } = await startTranscriber({ modelId: MODEL.id, log: quiet, store, spawn: fakeSpawn });
  assert.equal(request.model, MODEL);
  assert.equal(request.dir, `/models/${MODEL.id}`);
  assert.deepEqual(store.calls, []);
});

test("没下载过的不自己去下：直接报错。下不下由用户点（models/library.mjs）", async () => {
  const store = fakeStore(false);
  await assert.rejects(startTranscriber({ modelId: MODEL.id, log: quiet, store, spawn: fakeSpawn }), /还没下载/);
  assert.deepEqual(store.calls, []);
});

test("清单里没有的模型直接报错", async () => {
  await assert.rejects(
    startTranscriber({ modelId: "nope", log: quiet, store: fakeStore(true), spawn: fakeSpawn }),
    /nope/,
  );
});

test("自动加速时显卡上没装起来（报错、或者转写进程崩了）就换 CPU 再装一次，并记一笔", async () => {
  const tried = [];
  const warned = [];
  const spawn = async (request) => {
    tried.push(request.options?.backend);
    if (request.options?.backend !== "cpu") throw new Error("转写进程还没装好模型就退出了（退出码 3221225477）");
    return { request };
  };
  const log = { ...quiet, warn: (event, fields) => warned.push([event, fields.model]) };
  const { request } = await startTranscriber({ modelId: MODEL.id, log, store: fakeStore(true), spawn });
  assert.deepEqual(tried, ["auto", "cpu"]);
  assert.equal(request.options.backend, "cpu");
  assert.deepEqual(warned, [["transcriber_gpu_failed", MODEL.id]]);
});

test("只用 CPU：一开始就交代运行库走 CPU；CPU 上也没装起来就照实报错，不再换", async () => {
  const tried = [];
  const spawn = async (request) => {
    tried.push(request.options?.backend);
    return { request };
  };
  await startTranscriber({ modelId: MODEL.id, log: quiet, store: fakeStore(true), spawn, acceleration: "cpu" });
  assert.deepEqual(tried, ["cpu"]);

  const failing = async () => {
    throw new Error("坏了");
  };
  await assert.rejects(
    startTranscriber({ modelId: MODEL.id, log: quiet, store: fakeStore(true), spawn: failing, acceleration: "cpu" }),
    /坏了/,
  );
});

test("只能跑在 CPU 上的运行库（sherpa-onnx）没装起来就直接报错：换 CPU 也是同一回事", async () => {
  let attempts = 0;
  const spawn = async () => {
    attempts += 1;
    throw new Error("模型文件坏了");
  };
  const sherpa = findModel("sensevoice-small-int8");
  await assert.rejects(
    startTranscriber({ modelId: sherpa.id, log: quiet, store: fakeStore(true), spawn }),
    /模型文件坏了/,
  );
  assert.equal(attempts, 1);
});
