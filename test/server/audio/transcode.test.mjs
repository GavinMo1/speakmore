import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createTranslator } from "../../../src/i18n/index.mjs";
import { toWav } from "../../../src/server/audio/transcode.mjs";

const zh = createTranslator("zh-CN");
/** 报错里给人看的那句，按中文翻出来对得上 */
const said = (pattern) => (error) => pattern.test(zh.text(error.problem ?? error.message));

// 测试用的录音是 ffmpeg 生成的纯音调（Opus，单声道），不是谁的说话声
const fixture = (name) => readFileSync(join(import.meta.dirname, "../../fixtures/audio", name));

function describeWav(wav) {
  return {
    format: wav.toString("ascii", 8, 12),
    channels: wav.readUInt16LE(22),
    sampleRate: wav.readUInt32LE(24),
    seconds: wav.readUInt32LE(40) / 2 / wav.readUInt32LE(24),
  };
}

test("悬浮条录的 WebM 换成 16 kHz 单声道 WAV，时长不变", async () => {
  const converted = await toWav(fixture("tone-1s.webm"), "audio/webm");
  assert.equal(converted.mimeType, "audio/wav");
  const wav = describeWav(converted.audio);
  assert.equal(wav.format, "WAVE");
  assert.equal(wav.channels, 1);
  assert.equal(wav.sampleRate, 16_000);
  assert.ok(Math.abs(wav.seconds - 1) < 0.05, `${wav.seconds} 秒`);
});

test("不转的格式直接报错，说清是哪一种：原版 Typeless 的 Ogg 也不转", async () => {
  await assert.rejects(toWav(Buffer.from("RIFF"), "audio/aac"), /audio\/aac/);
  await assert.rejects(toWav(fixture("tone-1s.ogg"), "audio/ogg"), /audio\/ogg.*只认 audio\/webm/);
});

test("内容坏了解不出声音时报错，不交出一段空的 WAV", async () => {
  await assert.rejects(
    toWav(Buffer.from("\x1aE\xdf\xa3 but not really audio", "latin1"), "audio/webm"),
    said(/解不出/),
  );
});
