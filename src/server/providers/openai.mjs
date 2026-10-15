import { msg } from "../../i18n/index.mjs";
import { encodeWav } from "../audio/pcm.mjs";
import { quote } from "./errors.mjs";
import { costOf } from "./prices/openai.mjs";

// OpenAI 的适配器：gpt-audio 系列在 Chat Completions 里收音频，一次请求完成识别和整理，和 Gemini 一样。
// 不用官方 SDK：只用到这一个接口，SDK 装上有 21 MB，会让一行命令安装的包变大。下面的请求格式和报错
// 都对着官方文档写、拿真的 key 实测过。

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** 只收 wav 和 mp3（实测传 webm、ogg 回 400 "Supported values are: 'wav' and 'mp3'"）。我们只换得出 wav */
export const AUDIO_TYPES = ["audio/wav"];
const FORMATS = { "audio/wav": "wav" };

/** 验证 key 用的 0.1 秒静音。这几个模型不接受纯文字的请求（实测 400："either input content or output modality contain audio"） */
const SILENCE = encodeWav(new Float32Array(1_600), 16_000).toString("base64");

/** OpenAI 回了一个错误。status 是 HTTP 状态码，code 是它给的错误码（invalid_api_key、model_not_found…） */
class OpenAIError extends Error {
  constructor(status, error) {
    super(`OpenAI 回了 ${status}${error?.code ? ` ${error.code}` : ""}：${error?.message ?? "（没有说明）"}`);
    this.name = "OpenAIError";
    this.status = status;
    this.code = error?.code ?? null;
    this.said = error?.message ?? "";
  }
}

/**
 * @param {{ apiKey: string, model: string, fetch?: typeof fetch }} options fetch 在测试时换成假的
 */
export function createClient({ apiKey, model, fetch = globalThis.fetch }) {
  async function complete(body, signal) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, modalities: ["text"], ...body }),
      signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // 中间的网关偶尔会回一页 HTML：按状态码说，正文不要
    }
    if (!response.ok) throw new OpenAIError(response.status, payload?.error);
    return payload;
  }

  return {
    /** 最小的请求：0.1 秒静音、只要 1 个 token（这时它回的 finish_reason 是 length，不算失败）。实测约 0.7 秒 */
    async ping({ signal }) {
      const payload = await complete(
        {
          max_completion_tokens: 1,
          messages: [
            { role: "user", content: [{ type: "input_audio", input_audio: { data: SILENCE, format: "wav" } }] },
          ],
        },
        signal,
      );
      return { usage: usageOf(payload, model) };
    },

    /**
     * @returns {Promise<{ text: string | null, problem: object | null, usage: object }>} 模型的原文（收尾交给调用方）、
     *   用不了的原因、这一次的用量。用不了的回话（被截断、被拒绝）也收了钱，所以不在这里抛错，由调用方记完账再报错
     */
    async generate({ audio, mimeType, systemPrompt, reminder, signal }) {
      const payload = await complete(
        {
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "input_audio", input_audio: { data: audio.toString("base64"), format: FORMATS[mimeType] } },
                { type: "text", text: reminder },
              ],
            },
          ],
        },
        signal,
      );
      const choice = payload?.choices?.[0];
      // 被截断或被拦下的半截文字不能当成品贴出去
      const problem = choice?.message?.refusal
        ? msg("model.blocked", { provider: "OpenAI", reason: quote(choice.message.refusal) })
        : choice?.finish_reason !== "stop"
          ? msg("model.unfinished", { provider: "OpenAI", reason: String(choice?.finish_reason) })
          : null;
      return { text: problem ? null : choice.message.content, problem, usage: usageOf(payload, model) };
    },
  };
}

/**
 * 回话里的用量 → 记账用的样子。字段对着实测的回话写的：prompt_tokens 含音频和命中缓存的，
 * completion_tokens 含思考的和音频的；没有的项是 0。按回话报的型号算钱，没报就按请求的。
 */
function usageOf(payload, model) {
  const usage = payload?.usage ?? {};
  const input = usage.prompt_tokens ?? 0;
  const output = usage.completion_tokens ?? 0;
  const audio = usage.prompt_tokens_details?.audio_tokens ?? 0;
  const audioOutput = usage.completion_tokens_details?.audio_tokens ?? 0;
  const billed = payload?.model ?? model;
  return {
    model: billed,
    inputTokens: input,
    audioTokens: audio,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: output,
    thinkingTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    costUsd: costOf(billed, { text: input - audio, audio, textOutput: output - audioOutput, audioOutput }),
  };
}

/**
 * 认 OpenAI 回的报错（假 key 的 401 和模型名写错的 404 都实测过；没额度的 429 照官方文档写的错误码）。
 * 不认得的返回 null。
 */
export function classifyError(error) {
  if (!(error instanceof OpenAIError)) return null;
  // 回的不是 JSON（前面的网关回了一页 HTML）时没有原话，至少带上状态码
  const said = quote(error.said) || `HTTP ${error.status}`;
  if (error.status === 401) return { kind: "key", problem: msg("model.keyInvalid") };
  // 按网络出口所在地区拒的（官方文档写的错误码）：key 没问题，开着代理或换个网络就好，不能叫人换 key
  if (error.code === "unsupported_country_region_territory") {
    return { kind: "unavailable", problem: msg("model.regionBlocked", { provider: "OpenAI", said }) };
  }
  if (error.code === "insufficient_quota") return { kind: "key", problem: msg("model.noQuota") };
  if (error.status === 403) return { kind: "key", problem: msg("model.forbidden", { said }) };
  if (error.status === 429 || error.status >= 500) {
    return { kind: "unavailable", problem: msg("model.unavailable", { provider: "OpenAI", said }) };
  }
  if (error.status === 404 || error.code === "model_not_found") {
    return { kind: "other", problem: msg("model.notFound", { provider: "OpenAI", said }) };
  }
  return { kind: "other", problem: msg("model.rejected", { provider: "OpenAI", said }) };
}
