import { msg } from "../../i18n/index.mjs";
import { encodeWav } from "../audio/pcm.mjs";
import { COMPATIBLE_URL, classifyError as classifyDashScope, post } from "./dashscope.mjs";
import { quote } from "./errors.mjs";
import { costOf } from "./prices/bailian.mjs";

// 阿里云百炼的原生适配器：通义的 Omni 系列在 OpenAI 兼容的 Chat Completions 里收音频，一次请求出成品。
// 请求和回话的字段对着百炼的 Qwen-Omni 文档写，2026-10-16 拿真的 key 把四个型号都实测过：
//   - 音频写成 data URI（data:audio/wav;base64,…），format 写 wav。只换得出 wav，所以只收 wav
//   - 文档说只支持流式输出，实测不流式也照样回整段，这里用不流式：成品要等整段才贴，流式只多一层拆包
//   - 默认开着思考：qwen3.8-omni-flash 一段 23 秒的录音多出 113 个推理 token、5.4 秒；带 enable_thinking: false 后
//     回话里没有推理内容。整理文字用不着思考，一律关掉
//   - 只要文字：modalities 写 ["text"]，不然它连语音一起出、按语音的价收

const ENDPOINT = `${COMPATIBLE_URL}/chat/completions`;
const NAME = "Bailian";

export const AUDIO_TYPES = ["audio/wav"];

/** 验证 key 用的 0.1 秒静音：和真的请求走同一条路（收音频），key、模型名、开没开通都在这里暴露 */
const SILENCE = `data:audio/wav;base64,${encodeWav(new Float32Array(1_600), 16_000).toString("base64")}`;

/**
 * @param {{ apiKey: string, model: string, fetch?: typeof fetch }} options fetch 在测试时换成假的
 */
export function createClient({ apiKey, model, fetch = globalThis.fetch }) {
  const complete = (body, signal) =>
    post(ENDPOINT, {
      apiKey,
      body: { model, modalities: ["text"], enable_thinking: false, ...body },
      signal,
      fetch,
    });

  return {
    async ping({ signal }) {
      const payload = await complete(
        {
          max_tokens: 1,
          messages: [
            { role: "user", content: [{ type: "input_audio", input_audio: { data: SILENCE, format: "wav" } }] },
          ],
        },
        signal,
      );
      return { usage: usageOf(payload, model) };
    },

    /**
     * @returns {Promise<{ text: string | null, problem: object | null, usage: object }>} 同 openai.mjs 的 generate
     */
    async generate({ audio, mimeType, systemPrompt, reminder, signal }) {
      const payload = await complete(
        {
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: { data: `data:${mimeType};base64,${audio.toString("base64")}`, format: "wav" },
                },
                { type: "text", text: reminder },
              ],
            },
          ],
        },
        signal,
      );
      const choice = payload?.choices?.[0];
      const finish = choice?.finish_reason;
      const problem =
        finish === "content_filter"
          ? msg("model.blocked", { provider: NAME, reason: finish })
          : finish !== "stop"
            ? msg("model.unfinished", { provider: NAME, reason: quote(String(finish)) })
            : null;
      return { text: problem ? null : (choice.message.content ?? ""), problem, usage: usageOf(payload, model) };
    },
  };
}

/** 回话里的用量 → 记账用的样子。prompt_tokens 里含音频的（prompt_tokens_details.audio_tokens） */
function usageOf(payload, model) {
  const usage = payload?.usage ?? {};
  const input = usage.prompt_tokens ?? 0;
  const audio = usage.prompt_tokens_details?.audio_tokens ?? 0;
  const output = usage.completion_tokens ?? 0;
  const billed = payload?.model ?? model;
  return {
    model: billed,
    inputTokens: input,
    audioTokens: audio,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: output,
    thinkingTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    costUsd: costOf(billed, { text: input - audio, audio, output }),
  };
}

export const classifyError = (error) => classifyDashScope(error, { name: NAME });
