import { encodeWav } from "../../audio/pcm.mjs";
import { cnyToUsd } from "../../currency.mjs";
import { classifyError as classifyUpload, postAudio, textIn } from "./multipart.mjs";

// MiniMax 的云端转写适配器：asr-1.0 的同步接口。照官方文档写，未拿真 key 验证
// （https://platform.minimax.cn/docs/guides/speech-to-text、https://platform.minimax.cn/docs/api-reference/speech-to-text）：
//   - POST https://api.minimax.cn/v1/speech_to_text，multipart 交 model 和 file。不开 stream 时一次回整段：{ text, duration, trace_id }
//   - 不带 language 请求头时自动认语种，中英混说也认；一段最长 500 秒、最大 50 MB，更长的由 transcriber.mjs 切开
//   - 按回话里的 duration（秒）计费，价目页写的是每小时 2.5 元（https://platform.minimax.cn/docs/pricing/overview）
//   - 报错照 OpenAI 的写法，HTTP 状态码就是错误码：401 key 不对、402 余额不足、422 内容涉敏、429 限流，按状态码认就够

const NAME = "MiniMax";
const ENDPOINT = "https://api.minimax.cn/v1/speech_to_text";
const SECONDS_PER_HOUR = 3_600;
/** 人民币每小时 */
const PER_HOUR = Object.freeze({ "asr-1.0": 2.5 });

/** 验证 key 用的 0.1 秒静音。转出来是空的，key、模型名、余额都会在这里暴露 */
const SILENCE = encodeWav(new Float32Array(1_600), 16_000);

/**
 * @param {{ apiKey: string, model: string, fetch?: typeof fetch }} options
 * @returns {{ ping(o: { signal?: AbortSignal }): Promise<{ text: string, usage: object }>,
 *   transcribe(o: { wav: Buffer, signal?: AbortSignal }): Promise<{ text: string, usage: object }> }}
 */
export function createClient({ apiKey, model, fetch = globalThis.fetch }) {
  async function transcribe({ wav, signal }) {
    const payload = await postAudio(ENDPOINT, { name: NAME, apiKey, wav, fields: { model }, signal, fetch });
    const price = PER_HOUR[model];
    return {
      text: textIn(payload, NAME),
      usage: {
        model,
        inputTokens: 0,
        audioTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        costUsd:
          price === undefined || typeof payload.duration !== "number"
            ? null
            : cnyToUsd((payload.duration * price) / SECONDS_PER_HOUR),
      },
    };
  }
  return { ping: ({ signal }) => transcribe({ wav: SILENCE, signal }), transcribe };
}

export const classifyError = (error) => classifyUpload(error, { name: NAME });
