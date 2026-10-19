import { msg } from "../../../i18n/index.mjs";
import { encodeWav } from "../../audio/pcm.mjs";
import { quote } from "../../providers/errors.mjs";
import { classifyError as classifyUpload, postAudio, textIn, UploadError } from "./multipart.mjs";
import { costOf } from "./prices/zhipu.mjs";
import { cloudModelOf, findCloudTranscriber } from "./vendors.mjs";

// 智谱的云端转写适配器：GLM-ASR-2512 的同步接口。照官方文档写，2026-10-16 拿真 key 实测过：23 秒的录音 1.8 秒回整段，
// 55 秒的切成三段一起发、0.9 秒回齐；0.1 秒静音验 key 回 200，错的 key 回 401（1000 身份验证失败）
// （https://docs.bigmodel.cn/api-reference/模型-api/语音转文本、https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-asr-2512）：
//   - POST /api/paas/v4/audio/transcriptions，multipart 交 model、stream 和 file（wav 或 mp3）。stream 写 false 就一次回整段，
//     原文在 text
//   - 一段最长 30 秒、最大 25 MB。更长的录音由 transcriber.mjs 按清单里的 maxSeconds 切开，这里只管一段
//   - 回话不报用量，按录音时长记账（价目在 prices/zhipu.mjs，是个约数）
//   - 用户词典交成热词：每个词一个 hotwords 字段（文档写的是字符串数组，最多 100 个）。2026-10-19 拿真录音试过，
//     这样写、写成一段 JSON 都生效（multica、DeepSeek Harness 认对了）；选前者，词里带逗号也不会被拆开
//   - 报错写成 {"error":{"code","message"}}，业务码见 https://docs.bigmodel.cn/cn/api/api-code。欠费是 429 加 1113，
//     照状态码会被当成暂时用不了，单独认出来

const NAME = "Zhipu";
const ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions";
/** 验证 key 用的 0.1 秒静音。转出来是空的，key、模型名、余额都会在这里暴露 */
const SILENCE = encodeWav(new Float32Array(1_600), 16_000);

/** 挑好的词按做法放进请求的哪里（清单里型号声明的 kind）：热词是每个词一个 hotwords 字段 */
const VOCABULARY = { hotwords: (terms) => ({ hotwords: terms }) };

/** wav 有几秒：数据的字节数除以每秒的字节数，两样都写在头里 */
const secondsOf = (wav) => wav.readUInt32LE(40) / wav.readUInt32LE(28);

/**
 * @param {{ apiKey: string, model: string, fetch?: typeof fetch }} options
 * @returns {{ ping(o: { signal?: AbortSignal }): Promise<{ text: string, usage: object }>,
 *   transcribe(o: { wav: Buffer, signal?: AbortSignal, vocabulary?: readonly string[] }): Promise<{ text: string, usage: object }> }}
 *   vocabulary：转写器按清单挑好的词（transcriber.mjs）
 */
export function createClient({ apiKey, model, fetch = globalThis.fetch }) {
  const listed = cloudModelOf(findCloudTranscriber("zhipu"), model);
  const place = listed?.vocabulary ? VOCABULARY[listed.vocabulary.kind] : null;
  if (listed?.vocabulary && !place) throw new Error(`智谱不会放 ${listed.vocabulary.kind} 这种词表（${model}）`);
  async function transcribe({ wav, signal, vocabulary = [] }) {
    const payload = await postAudio(ENDPOINT, {
      name: NAME,
      apiKey,
      wav,
      fields: { model, stream: "false", ...(place && vocabulary.length > 0 ? place(vocabulary) : {}) },
      signal,
      fetch,
    });
    return {
      text: textIn(payload, NAME),
      usage: {
        model: payload.model ?? model,
        inputTokens: 0,
        audioTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        costUsd: costOf(model, { seconds: secondsOf(wav) }),
      },
    };
  }
  return { ping: ({ signal }) => transcribe({ wav: SILENCE, signal }), transcribe };
}

/** 先认智谱自己的业务码，别的按状态码（multipart.mjs） */
export function classifyError(error) {
  if (error instanceof UploadError && error.code === "1113") return { kind: "key", problem: msg("model.noQuota") };
  // 模型不存在回的是 400
  if (error instanceof UploadError && error.code === "1211") {
    return { kind: "other", problem: msg("model.notFound", { provider: NAME, said: quote(error.said) }) };
  }
  return classifyUpload(error, { name: NAME });
}
