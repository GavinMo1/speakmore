import { GoogleGenAI } from "@google/genai";
import { Converter } from "opencc-js/t2cn";
import { NO_SPEECH_MARK, SYSTEM_PROMPT, TASK_REMINDER } from "./prompt.mjs";

// 下面三样都是模型偶尔写坏的地方，提示词里说了也压不住，所以在代码里兜底。
// 数字来自 scripts/dev/eval-prompt.mjs：同一批 60 条真实录音跑了 12 遍，共 720 条成品。

const toSimplified = Converter({ from: "t", to: "cn" });
/**
 * 成品前面多出来的一个外文词（720 条里 14 条，像 "me""thought""get_prompt""особен"）。
 * 它们要么紧贴着后面的汉字，要么单独占一行；他真以英文开头时后面是空格或标点（原版 2853 条成品里只有 1 条例外）。
 */
const LEAKED_PREFIX = /^[A-Za-z_Ѐ-ӿ]+(?:\.?(?=[一-鿿])|[ \t]*\n\s*)/;
/** 模型听音频时自带"几分几秒"的定位，偶尔会写进正文（720 条里 10 条，像"全面开干、 00:30 全面迁移"） */
const STRAY_TIMESTAMP = /(?<!\d)\d{1,2}:\d{2}(?!\d)/;

/**
 * "音频进、成品文字出"的那一步，用 Gemini 一次完成识别和整理。
 * 原版服务端内部怎么做的看不到；这里选一步到位，是因为只需要一家服务、一次请求。
 */
export function createGeminiRefiner({ apiKey, model, thinkingLevel, timeoutMs, log }) {
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
    refine(audio, { mimeType, signal }) {
      const parts = [{ inlineData: { mimeType, data: audio.toString("base64") } }, { text: TASK_REMINDER }];

      const generateOnce = async () => {
        const timeout = AbortSignal.timeout(timeoutMs);
        const response = await client.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          // 不设 temperature。设成 0 时，60 条真实录音里有 10 条成品是坏的（开头多出一个不相干的外文词、
          // 只出了开头一小截、中间一长串下划线），去掉这个设置后同一批降到 5 条，截断和下划线没再出现。
          config: {
            systemInstruction: SYSTEM_PROMPT,
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
      };

      return generateClean(generateOnce, log);
    },
  };
}

/**
 * 拿一次成品；里面夹着时间戳就重来一次，用第二次的结果。
 * 不直接把时间戳删掉，是因为他也可能真的说了钟点：重来一遍还有，就当是他说的。
 * 原版 2853 条成品里没有一条带这种写法，所以多出来的这一次请求几乎只落在写坏的成品上。
 *
 * @param {() => Promise<string>} generateOnce
 * @param {{ warn: (event: string, fields: object) => void }} log
 */
export async function generateClean(generateOnce, log) {
  const first = await generateOnce();
  if (!STRAY_TIMESTAMP.test(first)) return first;
  log.warn("refine_retry", { reason: "成品里夹着时间戳" });
  return generateOnce();
}

/**
 * 模型的原始输出 → 要贴出去的文字。没有人声（标记）或没有输出时是空字符串。
 * - 繁转简：提示词里写了"一律写简体字"，模型仍会在一长段话中间冒出"這個"，同一条录音 6 遍里出现 5 遍。
 * - 去掉最后的句号：原版近两个月的成品里，以陈述句收尾的有八成多不带句号，中间各段的句号都在。
 */
export function textFromModelOutput(output) {
  const text = (output ?? "").trim();
  if (text === NO_SPEECH_MARK) return "";
  return toSimplified(text.replace(LEAKED_PREFIX, "")).replace(/。$/, "");
}
