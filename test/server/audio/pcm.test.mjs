import assert from "node:assert/strict";
import { test } from "node:test";
import { downsample, encodeWav, mixDown } from "../../../src/server/audio/pcm.mjs";

const sine = (frequency, sampleRate, seconds) =>
  Float32Array.from({ length: Math.round(sampleRate * seconds) }, (_, i) =>
    Math.sin((2 * Math.PI * frequency * i) / sampleRate),
  );

/** 去掉两头滤波器还没填满的那一截再算均方根 */
function rms(samples) {
  const middle = samples.subarray(200, samples.length - 200);
  let sum = 0;
  for (const value of middle) sum += value * value;
  return Math.sqrt(sum / middle.length);
}

test("WAV：44 字节的头写对了（单声道、16 位、给定的采样率），后面是小端的 16 位样本", () => {
  const wav = encodeWav(Float32Array.from([0, 0.5, -0.5, 1, -1]), 16_000);
  assert.equal(wav.length, 44 + 5 * 2);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(wav.readUInt16LE(20), 1, "PCM");
  assert.equal(wav.readUInt16LE(22), 1, "单声道");
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt32LE(28), 32_000, "每秒字节数");
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(40), 10);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => wav.readInt16LE(44 + i * 2)),
    [0, 16384, -16384, 32767, -32768],
  );
});

test("WAV：超出 ±1 的样本截到边上，不绕回成相反的符号", () => {
  const wav = encodeWav(Float32Array.from([1.7, -3]), 16_000);
  assert.deepEqual([wav.readInt16LE(44), wav.readInt16LE(46)], [32767, -32768]);
});

test("多声道合成单声道取平均；本来就是单声道的原样返回", () => {
  const left = Float32Array.from([1, 0.5]);
  assert.equal(mixDown([left]), left);
  assert.deepEqual(Array.from(mixDown([left, Float32Array.from([0, -0.5])])), [0.5, 0]);
});

test("48 kHz 降到 16 kHz：长度是三分之一，说话的频段（1 kHz）幅度不变", () => {
  const input = sine(1_000, 48_000, 0.5);
  const output = downsample(input, 48_000, 16_000);
  assert.equal(output.length, Math.ceil(input.length / 3));
  assert.ok(Math.abs(rms(output) / rms(input) - 1) < 0.01, `增益 ${rms(output) / rms(input)}`);
});

test("降采样之前先滤掉 8 kHz 以上的声音，不让它折回来变成杂音", () => {
  // 12 kHz 不滤的话会折成 4 kHz，正落在说话的频段里
  const input = sine(12_000, 48_000, 0.5);
  const output = downsample(input, 48_000, 16_000);
  assert.ok(rms(output) / rms(input) < 0.01, `残留 ${rms(output) / rms(input)}`);
});

test("采样率本来就对时原样返回；不是整数倍的拒绝，不悄悄出一段走调的声音", () => {
  const input = sine(440, 16_000, 0.1);
  assert.equal(downsample(input, 16_000, 16_000), input);
  assert.throws(() => downsample(sine(440, 44_100, 0.1), 44_100, 16_000), /44100/);
});
