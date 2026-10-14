import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { toWav } from "../../../src/server/audio/transcode.mjs";

// 测试用的录音是 ffmpeg 生成的纯音调（Opus，单声道），不是谁的说话声。chained 是两段 Ogg 首尾相接，
// 和原版 Typeless 分块上传、服务端拼起来的样子一样
const fixture = (name) => readFileSync(join(import.meta.dirname, "../../fixtures/audio", name));

function describeWav(wav) {
  return {
    format: wav.toString("ascii", 8, 12),
    channels: wav.readUInt16LE(22),
    sampleRate: wav.readUInt32LE(24),
    seconds: wav.readUInt32LE(40) / 2 / wav.readUInt32LE(24),
  };
}

for (const [name, mimeType, seconds] of [
  ["tone-1s.webm", "audio/webm", 1],
  ["tone-1s.ogg", "audio/ogg", 1],
  ["tone-chained-3s.ogg", "audio/ogg", 3],
]) {
  test(`${name} 换成 16 kHz 单声道 WAV，时长不变`, async () => {
    const converted = await toWav(fixture(name), mimeType);
    assert.equal(converted.mimeType, "audio/wav");
    const wav = describeWav(converted.audio);
    assert.equal(wav.format, "WAVE");
    assert.equal(wav.channels, 1);
    assert.equal(wav.sampleRate, 16_000);
    assert.ok(Math.abs(wav.seconds - seconds) < 0.05, `${wav.seconds} 秒`);
  });
}

test("不认识的格式直接报错，说清是哪一种", async () => {
  await assert.rejects(toWav(Buffer.from("RIFF"), "audio/aac"), /audio\/aac/);
});

test("内容坏了解不出声音时报错，不交出一段空的 WAV", async () => {
  await assert.rejects(toWav(Buffer.from("OggS but not really audio"), "audio/ogg"), /解不出/);
});
