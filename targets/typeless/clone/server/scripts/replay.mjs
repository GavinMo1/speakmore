#!/usr/bin/env node
// 拿现成的 Ogg/Opus 文件当一次录音，按听写协议发给服务端，打印每条回包和耗时。
// 用来在没有客户端的时候验证服务端，也用来比较不同模型和提示词。
//
// 用法：node scripts/replay.mjs [--url ws://127.0.0.1:8790] <块1.ogg> [块2.ogg ...]
// 每个文件当作一块发出去。成品文字会打印在终端上。

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import WebSocket from "ws";

const { values, positionals: files } = parseArgs({
  options: { url: { type: "string", default: "ws://127.0.0.1:8790" } },
  allowPositionals: true,
});
if (files.length === 0) {
  console.error("用法：node scripts/replay.mjs [--url ws://127.0.0.1:8790] <块1.ogg> [块2.ogg ...]");
  process.exit(2);
}

const chunks = files.map((file) => readFileSync(file));
const audioId = randomUUID();
const socket = new WebSocket(`${values.url}/ws/rt_voice_flow?v=replay&m=0`);
const startedAt = performance.now();
const elapsed = () => `${String(Math.round(performance.now() - startedAt)).padStart(6)} ms`;
let endSentAt = null;

const fail = (reason) => {
  console.error(`${elapsed()}  失败：${reason}`);
  socket.terminate();
  process.exitCode = 1;
};

socket.on("error", (error) => fail(`连不上 ${values.url}：${error.message}`));
socket.on("close", (code) => {
  if (process.exitCode === undefined && endSentAt === null) fail(`连接提前关闭，关闭码 ${code}`);
});

socket.on("open", () => {
  console.log(`${elapsed()}  已连接，发 start_audio 和 ${chunks.length} 块音频`);
  socket.send(
    JSON.stringify({ type: "start_audio", audio_id: audioId, audio_chunk_time: 3, mode: "voice_transcript" }),
  );
  for (const [i, chunk] of chunks.entries()) {
    socket.send(JSON.stringify({ type: "set_audio_chunk_info", audio_id: audioId, index: i + 1, size: chunk.length }));
    socket.send(chunk);
  }
  socket.send(JSON.stringify({ type: "end_audio", audio_id: audioId }));
  endSentAt = performance.now();
});

socket.on("message", (data) => {
  const { K: kind, V: value } = JSON.parse(data.toString("utf8"));
  switch (kind) {
    case "audio_processing_completed":
      console.log(`${elapsed()}  ${kind}（end_audio 之后 ${Math.round(performance.now() - endSentAt)} ms）`);
      console.log(value.refined_text === "" ? "（空：没有听到人声）" : value.refined_text);
      socket.close();
      break;
    case "audio_processing_error":
    case "error":
      fail(`${kind} ${value.code}：${value.detail}`);
      break;
    default:
      console.log(`${elapsed()}  ${kind}`);
  }
});
