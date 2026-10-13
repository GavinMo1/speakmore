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
     * 启动时发一个最小的请求。实测进程里第一次整理要 3.4–4.1 秒，之后稳定在 1.7–1.9 秒
     * （闲置 3 分钟后也是）；先发这一个，慢的那一次就不会落在用户的第一句话上。
     * key 无效或模型名写错也会在这里暴露，不用等到第一次听写。
     */
    async warmUp() {
      await client.models.generateContent({
        model,
        contents: "1",
        config: { maxOutputTokens: 1, thinkingConfig: { thinkingLevel }, abortSignal: AbortSignal.timeout(timeoutMs) },
      });
    },

    /**
     * @param {Buffer} audio 合并后的整段录音
     * @param {{ mimeType: string, signal?: AbortSignal }} options signal 在客户端断开时用来取消
     * @returns {Promise<string>} 整理好的文字；没有人声时是空字符串
     */
    async refine(audio, { mimeType, signal }) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: audio.toString("base64") } }] }],
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
