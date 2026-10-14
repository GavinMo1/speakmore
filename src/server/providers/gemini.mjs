import { GoogleGenAI } from "@google/genai";
import { quote } from "./errors.mjs";

// Gemini 的适配器：一次请求同时完成识别和整理，录音原样交过去。
// 原版服务端内部怎么做的看不到；选一步到位，是因为只需要一家服务、一次请求。

/** 悬浮条录的 WebM、原版的 Ogg 都直接收。实测 7 块首尾相接的链式 Ogg 也能从头识别到尾 */
export const AUDIO_TYPES = ["audio/ogg", "audio/webm"];

/**
 * @param {{ apiKey: string, model: string, thinkingLevel: string }} options
 */
export function createClient({ apiKey, model, thinkingLevel }) {
  const client = new GoogleGenAI({ apiKey });

  return {
    /** 最小的请求：只要 1 个 token。key 无效、模型名或档位写错都会在这里暴露 */
    async ping({ signal }) {
      await client.models.generateContent({
        model,
        contents: "1",
        config: { maxOutputTokens: 1, thinkingConfig: { thinkingLevel }, abortSignal: signal },
      });
    },

    /** @returns {Promise<string | undefined>} 模型的原文，收尾交给调用方 */
    async generate({ audio, mimeType, systemPrompt, reminder, signal }) {
      const response = await client.models.generateContent({
        model,
        contents: [
          { role: "user", parts: [{ inlineData: { mimeType, data: audio.toString("base64") } }, { text: reminder }] },
        ],
        // 不设 temperature。设成 0 时，60 条真实录音里有 10 条成品是坏的（开头多出一个不相干的外文词、
        // 只出了开头一小截、中间一长串下划线），去掉这个设置后同一批降到 5 条，截断和下划线没再出现。
        config: { systemInstruction: systemPrompt, thinkingConfig: { thinkingLevel }, abortSignal: signal },
      });

      const blockReason = response.promptFeedback?.blockReason;
      if (blockReason) throw new Error(`Gemini 没有处理这段录音：${blockReason}`);
      // 被截断或被拦下的半截文字不能当成品贴出去
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== "STOP") throw new Error(`Gemini 没有正常结束：${finishReason}`);
      return response.text;
    },
  };
}

/** Gemini 的报错是一整段 JSON：{"error":{"code":503,"message":"…","status":"UNAVAILABLE"}}。不是这种形状时是 null */
function geminiError(detail) {
  try {
    const { error } = JSON.parse(detail);
    return typeof error?.message === "string" ? error : null;
  } catch {
    return null;
  }
}

/**
 * 认 Gemini 自己的报错（都是实测到的：假 key、写错的模型名、它偶尔回的 503）。不认得的返回 null。
 * @param {unknown} _error
 * @param {string} detail 抹掉 key 之后的报错原文
 */
export function classifyError(_error, detail) {
  if (/API key not valid|API_KEY_INVALID/.test(detail)) {
    return { kind: "key", problem: "这把 key 无效，检查有没有复制完整" };
  }
  const gemini = geminiError(detail);
  if (gemini === null) return null;
  if (gemini.code >= 500 || gemini.code === 429) {
    return { kind: "unavailable", problem: `Gemini 暂时用不了（${quote(gemini.message)}），过一会儿再试` };
  }
  return { kind: "other", problem: `Gemini 拒绝了请求：${quote(gemini.message)}` };
}
