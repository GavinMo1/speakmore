import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadSize, findModel } from "../../../src/models/catalog.mjs";
import { startTranscriber } from "../../../src/server/asr/start.mjs";

const quiet = { info() {}, warn() {}, error() {} };
const MODEL = findModel("qwen3-asr-0.6b-q8");

/** 假的模型仓：installed 决定装没装；装的时候按文件报一次满进度 */
function fakeStore(installed) {
  const calls = [];
  return {
    calls,
    isInstalled: () => installed,
    dirOf: (model) => `/models/${model.id}`,
    async install(model, { onProgress }) {
      calls.push(model.id);
      for (const file of Object.values(model.files))
        onProgress({ file: file.path, received: file.size, total: file.size });
    },
  };
}

const fakeSpawn = async (request) => ({ request });

test("没下载过的先下载，进度按整个模型算；装好以后在转写进程里装上", async () => {
  const store = fakeStore(false);
  const progress = [];
  const { request } = await startTranscriber({
    modelId: MODEL.id,
    log: quiet,
    store,
    spawn: fakeSpawn,
    onProgress: (p) => progress.push(p),
  });
  assert.deepEqual(store.calls, [MODEL.id]);
  assert.deepEqual(progress.at(-1), { received: downloadSize(MODEL), total: downloadSize(MODEL) });
  assert.equal(request.model, MODEL);
  assert.equal(request.dir, `/models/${MODEL.id}`);
});

test("已经装好的不再下载", async () => {
  const store = fakeStore(true);
  await startTranscriber({ modelId: MODEL.id, log: quiet, store, spawn: fakeSpawn });
  assert.deepEqual(store.calls, []);
});

test("清单里没有的模型直接报错", async () => {
  await assert.rejects(
    startTranscriber({ modelId: "nope", log: quiet, store: fakeStore(true), spawn: fakeSpawn }),
    /nope/,
  );
});
