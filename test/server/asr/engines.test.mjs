import assert from "node:assert/strict";
import { test } from "node:test";
import { windowed } from "../../../src/server/asr/engines/index.mjs";
import { FAMILIES as SHERPA } from "../../../src/server/asr/engines/sherpa-onnx.mjs";
import { vocabularySupport } from "../../../src/vocabulary/support.mjs";

const RATE = 16_000;
const tone = (seconds) => Float32Array.from({ length: seconds * RATE }, (_, i) => 0.3 * Math.sin(i / 5));
const concat = (...parts) => {
  const all = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return all;
};

/** 假的转写器：记下每次交来多长，按次序回 "一""二"… */
function fake() {
  const calls = [];
  return {
    calls,
    backend: "cpu",
    dispose() {},
    vocabularies: [],
    async transcribe(samples, options) {
      calls.push(samples.length / RATE);
      this.vocabularies.push(options?.vocabulary);
      return { text: "一二三四五"[calls.length - 1] };
    },
  };
}

test("统一接口：长录音按上限切开逐段交，文字按顺序接起来；backend、dispose 照旧", async () => {
  const inner = fake();
  const outer = windowed(inner, 20);
  const { text } = await outer.transcribe(concat(tone(15), new Float32Array(RATE), tone(15)));
  assert.equal(text, "一二");
  assert.equal(inner.calls.length, 2);
  for (const seconds of inner.calls) assert.ok(seconds <= 20);
  assert.equal(outer.backend, "cpu");
  assert.equal(outer.dispose, inner.dispose);
});

test("统一接口：全是静音的录音不交给模型，直接是空的；没有上限的模型也一样", async () => {
  const inner = fake();
  assert.deepEqual(await windowed(inner, null).transcribe(new Float32Array(8 * RATE)), { text: "" });
  assert.deepEqual(inner.calls, []);
  assert.deepEqual(await windowed(inner, null).transcribe(tone(3)), { text: "一" });
});

test("sherpa-onnx 的 Qwen3：没有人声时吐出的 None 换成空的，正常的字原样", () => {
  const { clean } = SHERPA["qwen3-asr"];
  assert.equal(clean("None"), "");
  assert.equal(clean("好的，就这么干。"), "好的，就这么干。");
  assert.equal(SHERPA["sense-voice"].clean, undefined);
});

test("transcribe.cpp：跑在显卡上时，装上之后先拿一段合成的声音预热一遍；跑在 CPU 上不用", async () => {
  const { load } = await import("../../../src/server/asr/engines/transcribe-cpp.mjs");
  const fakeRuntime = (backend, runs) => async () => ({
    TranscribeModel: {
      load: async () => ({
        backend,
        createSession: () => ({
          run: async (samples) => {
            runs.push(samples.length);
            return { text: "" };
          },
          dispose() {},
        }),
        dispose() {},
      }),
    },
  });
  const request = { model: { family: "qwen3-asr" }, file: () => "model.gguf" };

  const gpuRuns = [];
  const gpu = await load(request, { runtime: fakeRuntime("Vulkan0", gpuRuns) });
  assert.equal(gpu.backend, "Vulkan0");
  assert.deepEqual(gpuRuns, [16_000 * 1.5]);
  assert.equal(typeof gpu.warmupMs, "number");

  const cpuRuns = [];
  const cpu = await load(request, { runtime: fakeRuntime("CPU", cpuRuns) });
  assert.deepEqual(cpuRuns, []);
  assert.equal(cpu.warmupMs, null);
});

// ---------- 用户词典：配置表里写明收法的模型，按上限挑好交给运行库；放进哪里由各运行库的适配器管 ----------

test("统一接口：词典按这个模型的上限挑好，切开的每一段都带上；不收词表的模型交空的", async () => {
  const inner = fake();
  const outer = windowed(inner, 20, vocabularySupport("hotwords", { maxTerms: 2 }));
  await outer.transcribe(concat(tone(15), new Float32Array(RATE), tone(15)), { vocabulary: ["a", "b", "c"] });
  assert.deepEqual(inner.vocabularies, [
    ["a", "b"],
    ["a", "b"],
  ]);

  const plain = fake();
  await windowed(plain, null).transcribe(tone(2), { vocabulary: ["a"] });
  assert.deepEqual(plain.vocabularies, [[]]);
});

/** 假的 transcribe.cpp：记下每次 run 收到的参数 */
const tcRuntime = (runs) => async () => ({
  TranscribeModel: {
    load: async () => ({
      backend: "CPU",
      createSession: () => ({
        run: async (_samples, options) => {
          runs.push(options);
          return { text: "好" };
        },
        dispose() {},
      }),
      dispose() {},
    }),
  },
});

test("transcribe.cpp：Qwen3-ASR 的词表交给 run 的 vocabulary；没有词、SenseVoice 都不带", async () => {
  const { load } = await import("../../../src/server/asr/engines/transcribe-cpp.mjs");
  const runs = [];
  const qwen = await load({ model: { family: "qwen3-asr" }, file: () => "m.gguf" }, { runtime: tcRuntime(runs) });
  await qwen.transcribe(tone(1), { vocabulary: ["Runzo", "埋点"] });
  await qwen.transcribe(tone(1), { vocabulary: [] });
  const sense = await load({ model: { family: "sense-voice" }, file: () => "m.gguf" }, { runtime: tcRuntime(runs) });
  await sense.transcribe(tone(1), { vocabulary: ["Runzo"] });
  assert.deepEqual(runs, [
    { timestamps: "none", vocabulary: ["Runzo", "埋点"] },
    { timestamps: "none" },
    { timestamps: "none" },
  ]);
});

/** 假的 sherpa-onnx：记下每个流设了哪些选项 */
const sherpaRuntime = (options) => async () => ({
  default: {
    OfflineRecognizer: {
      createAsync: async () => ({
        createStream: () => {
          const set = {};
          options.push(set);
          return { setOption: (key, value) => (set[key] = value), acceptWaveform() {} };
        },
        decodeAsync: async () => ({ text: "好" }),
      }),
    },
  },
});

test("sherpa-onnx：Qwen3-ASR 的词表设成这个流的 hotwords（英文逗号隔开）；没有词、SenseVoice 都不设", async () => {
  const { load } = await import("../../../src/server/asr/engines/sherpa-onnx.mjs");
  const file = (role) => `/m/${role}`;
  const options = [];
  const qwen = await load({ model: { family: "qwen3-asr" }, file }, { runtime: sherpaRuntime(options) });
  await qwen.transcribe(tone(1), { vocabulary: ["Runzo", "Claude Code"] });
  await qwen.transcribe(tone(1), { vocabulary: [] });
  const sense = await load({ model: { family: "sense-voice" }, file }, { runtime: sherpaRuntime(options) });
  await sense.transcribe(tone(1), { vocabulary: ["Runzo"] });
  assert.deepEqual(options, [{ hotwords: "Runzo,Claude Code" }, {}, {}]);
});
