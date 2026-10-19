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
//
// 用户词典：每个型号怎么收写在清单里（vendors.mjs 的 vocabulary），这里按做法把挑好的词放进请求（VOCABULARY）。
// 2026-10-19 拿真 key 试过：qwen3-asr-flash 的 system 消息 content 要写成数组，写成字符串回 400
// "The dedicated task `asr` …"；qwen-audio 的热词在 parameters.vocabulary（{ 词: 权重 }）；fun-asr 的上下文是录音前的
// 一条 input_text 消息。

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

/** 背景文本：词连成一句，用中文逗号隔开（导出给词典评测的爬山脚本记下实际发了什么） */
export const contextOf = (terms) => terms.join("，");

/** 热词的权重：文档建议从 4 起（1–5） */
const HOTWORD_WEIGHT = 4;

/**
 * 挑好的词放进请求的哪里：按接口和这个型号的做法查。返回要加进请求的那几样，交给下面的接口拼进去：
 *   messages    放在录音那条消息前面的消息
 *   parameters  并进 parameters 的项
 */
const VOCABULARY = {
  chat: {
    context: (terms) => ({ messages: [{ role: "system", content: [{ type: "text", text: contextOf(terms) }] }] }),
  },
  dashscope: {
    hotwords: (terms) => ({
      parameters: { vocabulary: Object.fromEntries(terms.map((term) => [term, HOTWORD_WEIGHT])) },
    }),
    context: (terms) => ({ messages: [{ role: "user", content: [{ type: "input_text", text: contextOf(terms) }] }] }),
  },
};

const audioMessage = (wav) => ({
  role: "user",
  content: [{ type: "input_audio", input_audio: { data: dataUri(wav) } }],
});

const WIRES = {
  async chat({ apiKey, model, wav, signal, fetch, extra }) {
    const payload = await post(`${COMPATIBLE_URL}/chat/completions`, {
      apiKey,
      body: { model, messages: [...(extra.messages ?? []), audioMessage(wav)] },
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

  async dashscope({ apiKey, model, wav, signal, fetch, extra }) {
    const payload = await post(`${DASHSCOPE_URL}/services/aigc/multimodal-generation/generation`, {
      apiKey,
      headers: { "X-DashScope-SSE": "disable" },
      body: {
        model,
        input: { messages: [...(extra.messages ?? []), audioMessage(wav)] },
        parameters: { format: "wav", sample_rate: "16000", ...extra.parameters },
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
 *   transcribe(o: { wav: Buffer, signal?: AbortSignal, vocabulary?: readonly string[] }): Promise<{ text: string, usage: object }> }}
 *   vocabulary：转写器按清单挑好的词（transcriber.mjs），这个型号不收词表时是空的
 */
export function createClient({ apiKey, model, fetch = globalThis.fetch }) {
  // 清单外的型号按这一家默认模型的接口发
  const vendor = findCloudTranscriber("bailian");
  const listed = cloudModelOf(vendor, model);
  const wireId = (listed ?? cloudModelOf(vendor, vendor.defaultModel)).wire;
  const wire = WIRES[wireId];
  const place = listed?.vocabulary ? VOCABULARY[wireId][listed.vocabulary.kind] : null;
  if (listed?.vocabulary && !place)
    throw new Error(`百炼的 ${wireId} 接口不会放 ${listed.vocabulary.kind} 这种词表（${model}）`);
  return {
    // 验 key 只看回没回 2xx：拿静音去问，原文是空的、没有都正常
    ping: ({ signal }) => wire({ apiKey, model, wav: SILENCE, signal, fetch, extra: {} }),
    async transcribe({ wav, signal, vocabulary = [] }) {
      const extra = place && vocabulary.length > 0 ? place(vocabulary) : {};
      const reply = await wire({ apiKey, model, wav, signal, fetch, extra });
      // 回了 2xx 却找不到原文，说明接口和这里对不上：照实报错，不当成"没听到声音"、悄悄交出空文字
      if (typeof reply.text !== "string") throw new Error(`${NAME} 的回话里没有识别出的原文`);
      return reply;
    },
  };
}

export const classifyError = (error) => classifyDashScope(error, { name: NAME });
