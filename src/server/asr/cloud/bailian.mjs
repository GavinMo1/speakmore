import { encodeWav } from "../../audio/pcm.mjs";
import { COMPATIBLE_URL, classifyError as classifyDashScope, DASHSCOPE_URL, post } from "../../providers/dashscope.mjs";
import { costOf } from "./prices/bailian.mjs";
import { cloudModelOf, findCloudTranscriber } from "./vendors.mjs";

// 阿里云百炼的云端转写适配器。两套接口（见 vendors.mjs 的 wire），2026-10-16 拿真的 key 实测过：
//   chat       qwen3-asr-flash：OpenAI 兼容的 /chat/completions，音频写成 data URI 放进 input_audio，
//              原文在 choices[0].message.content，用量的 prompt_tokens 是音频 token、seconds 是时长
//   dashscope  qwen-audio、fun-asr：/services/aigc/multimodal-generation/generation，要写明 format 和 sample_rate，
//              关掉流式（X-DashScope-SSE: disable）。整段原文在 output.text（output.output.sentence 是带时间戳的分词，用不上），
//              用量是 usage.duration（秒），qwen-audio-3.1 另报 input_tokens、output_tokens
// 价目和记账在 prices/bailian.mjs。

const NAME = "Bailian";

/** 验证 key 用的 0.1 秒静音。转出来是空的，key、模型名、开没开通都会在这里暴露 */
const SILENCE = encodeWav(new Float32Array(1_600), 16_000);

const dataUri = (wav) => `data:audio/wav;base64,${wav.toString("base64")}`;

const usage = (model, { seconds, inputTokens = 0, audioTokens = 0, outputTokens = 0 }) => ({
  model,
  inputTokens,
  audioTokens,
  cachedTokens: 0,
  outputTokens,
  thinkingTokens: 0,
  costUsd: costOf(model, { seconds, inputTokens, outputTokens }),
});

const WIRES = {
  async chat({ apiKey, model, wav, signal, fetch }) {
    const payload = await post(`${COMPATIBLE_URL}/chat/completions`, {
      apiKey,
      body: {
        model,
        messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: dataUri(wav) } }] }],
      },
      signal,
      fetch,
    });
    const reported = payload?.usage ?? {};
    return {
      text: payload?.choices?.[0]?.message?.content,
      usage: usage(payload?.model ?? model, {
        seconds: reported.seconds ?? 0,
        inputTokens: reported.prompt_tokens ?? 0,
        audioTokens: reported.prompt_tokens_details?.audio_tokens ?? 0,
        outputTokens: reported.completion_tokens ?? 0,
      }),
    };
  },

  async dashscope({ apiKey, model, wav, signal, fetch }) {
    const payload = await post(`${DASHSCOPE_URL}/services/aigc/multimodal-generation/generation`, {
      apiKey,
      headers: { "X-DashScope-SSE": "disable" },
      body: {
        model,
        input: {
          messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: dataUri(wav) } }] }],
        },
        parameters: { format: "wav", sample_rate: "16000" },
      },
      signal,
      fetch,
    });
    const reported = payload?.usage ?? {};
    return {
      text: payload?.output?.text ?? payload?.output?.output?.text,
      usage: usage(model, {
        seconds: reported.duration ?? 0,
        inputTokens: reported.input_tokens ?? 0,
        audioTokens: reported.input_tokens ?? 0,
        outputTokens: reported.output_tokens ?? 0,
      }),
    };
  },
};

/**
 * @param {{ apiKey: string, model: string, fetch?: typeof fetch }} options
 * @returns {{ ping(o: { signal?: AbortSignal }): Promise<{ usage: object }>,
 *   transcribe(o: { wav: Buffer, signal?: AbortSignal }): Promise<{ text: string, usage: object }> }}
 */
export function createClient({ apiKey, model, fetch = globalThis.fetch }) {
  // 清单外的型号按这一家默认模型的接口发
  const vendor = findCloudTranscriber("bailian");
  const wire = WIRES[(cloudModelOf(vendor, model) ?? cloudModelOf(vendor, vendor.defaultModel)).wire];
  return {
    // 验 key 只看回没回 2xx：拿静音去问，原文是空的、没有都正常
    ping: ({ signal }) => wire({ apiKey, model, wav: SILENCE, signal, fetch }),
    async transcribe({ wav, signal }) {
      const reply = await wire({ apiKey, model, wav, signal, fetch });
      // 回了 2xx 却找不到原文，说明接口和这里对不上：照实报错，不当成"没听到声音"、悄悄交出空文字
      if (typeof reply.text !== "string") throw new Error(`${NAME} 的回话里没有识别出的原文`);
      return reply;
    },
  };
}

export const classifyError = (error) => classifyDashScope(error, { name: NAME });
