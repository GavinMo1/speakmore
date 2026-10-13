import assert from "node:assert/strict";
import { test } from "node:test";
import { startService } from "../src/main/service.mjs";

const quietLog = { info() {}, warn() {}, error() {} };
const OGG_CHUNK = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(60)]);

/** 按听写协议发一小段"录音"，返回服务端给的最后一条消息 */
function dictateOnce(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const audioId = crypto.randomUUID();
    socket.onerror = () => reject(new Error("连不上内置服务"));
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "start_audio", audio_id: audioId }));
      socket.send(
        JSON.stringify({ type: "set_audio_chunk_info", audio_id: audioId, index: 1, size: OGG_CHUNK.length }),
      );
      socket.send(OGG_CHUNK);
      socket.send(JSON.stringify({ type: "end_audio", audio_id: audioId }));
    };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.K === "audio_processing_completed" || message.K === "audio_processing_error") {
        socket.close();
        resolve(message);
      }
    };
  });
}

const fakeRefiner = (text, warmUp = async () => {}) => ({ warmUp, refine: async () => text });

test("没有 key 时服务照样在听，听写会失败并说明要去填 key", async (t) => {
  const service = await startService({ log: quietLog, createRefiner: () => fakeRefiner("不该用到") });
  t.after(() => service.close());
  assert.equal(service.ready, false);
  const reply = await dictateOnce(service.url);
  assert.equal(reply.K, "audio_processing_error");
  assert.match(reply.V.detail, /API key/);
});

test("换上能通过验证的 key 之后可以听写，地址不变", async (t) => {
  const seen = [];
  const service = await startService({
    log: quietLog,
    createRefiner: (options) => {
      seen.push(options.apiKey);
      return fakeRefiner("整理好的文字");
    },
  });
  t.after(() => service.close());
  const urlBefore = service.url;
  await service.useKey("key-1");
  assert.equal(service.ready, true);
  assert.equal(service.url, urlBefore);
  assert.deepEqual(seen, ["key-1"]);
  const reply = await dictateOnce(service.url);
  assert.equal(reply.K, "audio_processing_completed");
  assert.equal(reply.V.refined_text, "整理好的文字");
});

test("新 key 验证不过时报错，原来能用的那把继续用", async (t) => {
  const service = await startService({
    log: quietLog,
    createRefiner: ({ apiKey }) =>
      apiKey === "good"
        ? fakeRefiner("用的是好 key")
        : fakeRefiner("用的是坏 key", async () => {
            throw new Error("API key not valid");
          }),
  });
  t.after(() => service.close());
  await service.useKey("good");
  await assert.rejects(service.useKey("bad"), /API key not valid/);
  assert.equal(service.ready, true);
  assert.equal((await dictateOnce(service.url)).V.refined_text, "用的是好 key");
});

test("forgetKey 之后回到没有 key 的状态", async (t) => {
  const service = await startService({ log: quietLog, createRefiner: () => fakeRefiner("文字") });
  t.after(() => service.close());
  await service.useKey("key-1");
  service.forgetKey();
  assert.equal(service.ready, false);
  assert.equal((await dictateOnce(service.url)).K, "audio_processing_error");
});
