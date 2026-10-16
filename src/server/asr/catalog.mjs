// 本地转写模型的清单。一项是"一个模型在一个运行库里用的一份文件"：同一个 Qwen3-ASR，sherpa-onnx 用 ONNX、
// transcribe.cpp 用 GGUF，是两项。模型广场和评测（bench/）都从这里取。
//
// 这里只记从哪下载、校验值和说明，模型文件本身不进仓库：用到时下载到用户的机器上（store.mjs）。
// 下载地址钉在 Hugging Face 的某一次提交上，内容不会再变；每个文件下载完都按 sha256 校验。
// files 按用途起名（encoder、tokens…），运行库的适配器按这些名字把文件填进它的配置（engines/*.mjs 的 FAMILIES）。
// maxSeconds 是一次最多吃多少秒的音频，有上限的才写：更长的录音由 segment.mjs 切开逐段转写。
//
// 加一个模型 = 在这里加一项。它用的运行库要在 engines/index.mjs 登记过，family 要是那个运行库认得的。

const freeze = (model) => Object.freeze({ ...model, files: Object.freeze(model.files) });

export const MODELS = Object.freeze(
  [
    {
      id: "sensevoice-small-int8",
      name: "SenseVoice Small (int8)",
      engine: "sherpa-onnx",
      family: "sense-voice",
      license: "FunASR Model License",
      source: {
        repo: "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09",
        revision: "355f4d4884d8afd08aef04b9007a8556d7b463b2",
      },
      files: {
        model: {
          path: "model.int8.onnx",
          size: 237_115_547,
          sha256: "12ca1a2ae7ecf3e0019ef2822307ee0b5cadc9196569e379b4c4026f8205276d",
        },
        tokens: {
          path: "tokens.txt",
          size: 315_894,
          sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
        },
      },
    },
    {
      id: "qwen3-asr-0.6b-int8",
      name: "Qwen3-ASR 0.6B (int8)",
      engine: "sherpa-onnx",
      family: "qwen3-asr",
      // 这份 ONNX 导出时把解码器的 KV 缓存定死成 512 个位置（提示词 + 音频 + 输出的字都算在内），音频一秒约折 13 个。
      // 实测（bench/）：38 秒以上的录音只吐出 "language" 或空的，33–35 秒的悄悄丢掉后一半。按 20 秒一段切开留足余量
      maxSeconds: 20,
      license: "Apache-2.0",
      source: {
        repo: "csukuangfj2/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25",
        revision: "68818b2313fe77bd06f6a7c5068ff3ef59d02b8a",
      },
      files: {
        convFrontend: {
          path: "conv_frontend.onnx",
          size: 44_148_281,
          sha256: "d22dc4423e0940e49884e903d2ea2f7e5567c14fc1aed97e4e26d6b8f208ef9e",
        },
        encoder: {
          path: "encoder.int8.onnx",
          size: 182_491_662,
          sha256: "60748d3e6744a57c9c91e1b17424a6c2990567e8adceb0783940c03ed98fa9d9",
        },
        decoder: {
          path: "decoder.int8.onnx",
          size: 755_914_231,
          sha256: "4f6885be5959ae26af3089d38ee7972c5fafbeeb1cf8d5e76eab6d8b61ca5771",
        },
        tokenizerMerges: {
          path: "tokenizer/merges.txt",
          size: 1_671_853,
          sha256: "8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5",
        },
        tokenizerConfig: {
          path: "tokenizer/tokenizer_config.json",
          size: 12_487,
          sha256: "4942d005604266809309cabc9f4e9cb89ce855d59b14681fdc0e1cc62ea26c4c",
        },
        tokenizerVocab: {
          path: "tokenizer/vocab.json",
          size: 2_776_833,
          sha256: "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910",
        },
      },
    },
    {
      id: "qwen3-asr-0.6b-q8",
      name: "Qwen3-ASR 0.6B (Q8_0)",
      engine: "transcribe-cpp",
      family: "qwen3-asr",
      license: "Apache-2.0",
      source: { repo: "handy-computer/Qwen3-ASR-0.6B-gguf", revision: "7e7c69a577fa2725dfedbe34b5e999336e30a19b" },
      files: {
        gguf: {
          path: "Qwen3-ASR-0.6B-Q8_0.gguf",
          size: 850_423_456,
          sha256: "f081b2d5e23bd669d92cc331d722a8a0681943b8e6f34b48996fd5c319b5acd8",
        },
      },
    },
    {
      id: "sensevoice-small-q8",
      name: "SenseVoice Small (Q8_0)",
      engine: "transcribe-cpp",
      family: "sense-voice",
      license: "FunASR Model License",
      source: { repo: "handy-computer/SenseVoiceSmall-gguf", revision: "ff8f085a8fa2e5ccae0e849ef19ebc6dc18e608b" },
      files: {
        gguf: {
          path: "SenseVoiceSmall-Q8_0.gguf",
          size: 252_684_608,
          sha256: "6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29",
        },
      },
    },
  ].map(freeze),
);

/** @returns {(typeof MODELS)[number] | null} */
export function findModel(id) {
  return MODELS.find((model) => model.id === id) ?? null;
}

/** 一个模型要下载的总字节数 */
export function downloadSize(model) {
  return Object.values(model.files).reduce((sum, file) => sum + file.size, 0);
}
