import { dirname } from "node:path";
import { SPEECH_SAMPLE_RATE } from "../../audio/pcm.mjs";
import { placementOf } from "./placement.mjs";

// sherpa-onnx（k2-fsa，Apache-2.0）的适配器：ONNX Runtime 跑在 CPU 上，npm 上有 Mac 两种芯片、Windows、Linux 的预编译包。
// 接口见 index.mjs。

/** 不指定时用几个线程。评测里另给的话照给的 */
const DEFAULT_THREADS = 4;

/**
 * 认得的模型族。config：清单里的文件（按用途起的名字）怎么填进 sherpa-onnx 的 modelConfig，file(用途) 是那个文件的完整路径；
 * clean：这一族的输出里运行库没去掉的标记，换成干净的文字（没有就是原样）；
 * vocabulary：收用户词典的族才写，挑好的词怎么设到这一次识别的流上。
 */
export const FAMILIES = Object.freeze({
  "sense-voice": Object.freeze({
    config: (file) => ({
      // 打开反向文本规整：数字写成阿拉伯数字、带标点，和云端模型的成品更接近
      senseVoice: { model: file("model"), useInverseTextNormalization: 1 },
      tokens: file("tokens"),
    }),
  }),
  "qwen3-asr": Object.freeze({
    config: (file) => ({
      qwen3Asr: {
        convFrontend: file("convFrontend"),
        encoder: file("encoder"),
        decoder: file("decoder"),
        // 分词器是一个目录，三个文件都在里面
        tokenizer: dirname(file("tokenizerVocab")),
        // 词表不写在这里（那样换词典就要重建识别器），每次识别设在流上（vocabulary）
        hotwords: "",
      },
      tokens: "",
    }),
    // 流的 hotwords 选项：英文逗号隔开，运行库拆开后用空格连起来放进系统提示词（词里的逗号也被当成分隔，结果一样）。
    // 1.13.8 的源码 offline-recognizer-qwen3-asr-impl.cc 里是这样，2026-10-19 拿真实录音试过
    vocabulary: Object.freeze({ hotwords: (stream, terms) => stream.setOption("hotwords", terms.join(",")) }),
    // Qwen3-ASR 判断没有人声时输出 "language None"，sherpa-onnx 只去掉了前缀，剩下一个 None（实测：7.9 秒的纯静音）
    clean: (text) => (text === "None" ? "" : text),
  }),
});

export async function version() {
  const { default: sherpa } = await import("sherpa-onnx-node");
  return sherpa.version;
}

/**
 * @param {{ model: object, file: (role: string) => string, options?: { threads?: number } }} request
 * @param {{ runtime?: () => Promise<{ default: object }> }} [deps] 测试时换掉运行库
 */
export async function load({ model, file, options = {} }, { runtime = () => import("sherpa-onnx-node") } = {}) {
  const { default: sherpa } = await runtime();
  const { clean } = FAMILIES[model.family];
  const place = placementOf(model, FAMILIES[model.family], "sherpa-onnx");
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: SPEECH_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      ...FAMILIES[model.family].config(file),
      numThreads: options.threads ?? DEFAULT_THREADS,
      provider: "cpu",
      debug: 0,
    },
  });
  return {
    backend: "cpu",
    /** @param {{ vocabulary?: readonly string[] }} [options] 挑好的词（index.mjs 的 windowed） */
    async transcribe(samples, { vocabulary = [] } = {}) {
      const stream = recognizer.createStream();
      if (place && vocabulary.length > 0) place(stream, vocabulary);
      stream.acceptWaveform({ sampleRate: SPEECH_SAMPLE_RATE, samples });
      const result = await recognizer.decodeAsync(stream);
      const text = String(result.text ?? "").trim();
      return { text: clean ? clean(text) : text };
    },
    // sherpa-onnx 的 Node 包没有显式释放，识别器跟着垃圾回收走
    dispose() {},
  };
}
