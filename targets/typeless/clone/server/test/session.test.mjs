import assert from "node:assert/strict";
import { test } from "node:test";
import { ProtocolError } from "../src/protocol.mjs";
import { RecordingSession } from "../src/session.mjs";

const ogg = (payload) => Buffer.concat([Buffer.from("OggS"), Buffer.from(payload)]);
const newSession = (maxTotalBytes = 1024) => new RecordingSession("audio-1", { maxTotalBytes });
const fails = (action, code) => assert.throws(action, (error) => error instanceof ProtocolError && error.code === code);

test("按序收块，合并结果是各块首尾相接", () => {
  const session = newSession();
  const first = ogg("aaaa");
  const second = ogg("bb");
  session.announceChunk({ index: 1, size: first.length });
  assert.deepEqual(session.addChunk(first), { index: 1, size: first.length });
  session.announceChunk({ index: 2, size: second.length });
  session.addChunk(second);

  assert.equal(session.chunkCount, 2);
  assert.equal(session.totalBytes, first.length + second.length);
  assert.deepEqual(session.merge(), Buffer.concat([first, second]));
});

test("没有声明就来了音频帧", () => {
  fails(() => newSession().addChunk(ogg("a")), "chunk_without_info");
});

test("序号从 1 开始，不能跳、不能重复", () => {
  fails(() => newSession().announceChunk({ index: 0, size: 5 }), "chunk_out_of_order");
  fails(() => newSession().announceChunk({ index: 2, size: 5 }), "chunk_out_of_order");

  const session = newSession();
  session.announceChunk({ index: 1, size: 5 });
  session.addChunk(ogg("a"));
  fails(() => session.announceChunk({ index: 1, size: 5 }), "chunk_out_of_order");
});

test("连着两条声明，中间没有音频帧", () => {
  const session = newSession();
  session.announceChunk({ index: 1, size: 5 });
  fails(() => session.announceChunk({ index: 2, size: 5 }), "chunk_missing");
});

test("实际字节数和声明的不一样", () => {
  const session = newSession();
  session.announceChunk({ index: 1, size: 99 });
  fails(() => session.addChunk(ogg("a")), "chunk_size_mismatch");
  // 这一帧已经被消费掉了，同一个序号要重新声明才能再发
  fails(() => session.addChunk(ogg("a")), "chunk_without_info");
  assert.equal(session.chunkCount, 0);
});

test("不是 Ogg 开头的数据不收", () => {
  const session = newSession();
  session.announceChunk({ index: 1, size: 5 });
  fails(() => session.addChunk(Buffer.from("RIFFx")), "chunk_not_ogg");
});

test("总量超过上限", () => {
  const session = newSession(8);
  session.announceChunk({ index: 1, size: 5 });
  session.addChunk(ogg("a"));
  session.announceChunk({ index: 2, size: 5 });
  fails(() => session.addChunk(ogg("b")), "audio_too_large");
  assert.equal(session.totalBytes, 5);
});
