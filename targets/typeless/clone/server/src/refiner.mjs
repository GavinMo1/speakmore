import { GoogleGenAI } from "@google/genai";
import { NO_SPEECH_MARK, SYSTEM_PROMPT } from "./prompt.mjs";

/**
 * "音频进、成品文字出"的那一步，用 Gemini 一次完成识别和整理。
 * 原版服务端内部怎么做的看不到；这里选一步到位，是因为只需要一家服务、一次请求。
 */
export function createGeminiRefiner({ apiKey, model, thinkingLevel, timeoutMs }) {
  const client = new GoogleGenAI({ apiKey });

  return {
    /**
     * @param {Buffer} audio 合并后的 Ogg/Opus 录音
     * @param {{ signal?: AbortSignal }} [options] 客户端断开时用来取消
     * @returns {Promise<string>} 整理好的文字；没有人声时是空字符串
     */
    async refine(audio, { signal } = {}) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await client.models.generateContent({
        model,
        contents: [
          { role: "user", parts: [{ inlineData: { mimeType: "audio/ogg", data: audio.toString("base64") } }] },
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0,
          thinkingConfig: { thinkingLevel },
          abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        },
      });

      const blockReason = response.promptFeedback?.blockReason;
      if (blockReason) throw new Error(`Gemini 没有处理这段录音：${blockReason}`);
      // 被截断或被拦下的半截文字不能当成品贴出去
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== "STOP") throw new Error(`Gemini 没有正常结束：${finishReason}`);

      return textFromModelOutput(response.text);
    },
  };
}

/** 模型的原始输出 → 要贴出去的文字。没有人声（标记）或没有输出时是空字符串 */
export function textFromModelOutput(output) {
  const text = (output ?? "").trim();
  return text === NO_SPEECH_MARK ? "" : text;
}
