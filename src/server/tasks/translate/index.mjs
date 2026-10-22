import { findLanguage, LANGUAGES } from "../../../languages.mjs";
import { translationFromModelOutput } from "./output.mjs";
import { polishTranslateInput, polishTranslatePrompt } from "./polish-prompt.mjs";
import { nativeTranslatePrompt, nativeTranslateReminder } from "./prompt.mjs";

// 语音翻译：他说完，把他的话译成目标语言贴出去，原文存进历史。
// 直出时让听音频的模型直接出目标语言；混合时整理那一步换成翻译的提示词；离线没有能翻译的模型，做不了（steps 里没有）。
// 目标语言每次说话由客户端在 set_mode_config 里给（output_language，照原版），写在提示词的最上面：
// 设置里、悬浮条上换了，下一次说话就按新的拼，提示词每次现拼、不留旧的。
// 用词典：先要听懂他说的专有名词，才译得对（转文字、整理原文都带上，同语音输入）。
// 提示词和收尾都在这个目录里，不引用语音输入（../dictate）的东西。

/**
 * 混合方式整理那一步收尾：模型没写出原文时，拿识别出来的字当原文存（总比没有强）
 * @param {{ id: string }} language
 */
const polishFinish = (language) => (output, transcript) => {
  const result = translationFromModelOutput(output, language);
  return result.source !== null || result.text === "" ? result : { ...result, source: transcript.trim() || null };
};

export const translate = Object.freeze({
  id: "translate",
  // 协议里的名字照原版（docs/04-voice-pipeline.md 的"模式"）
  mode: "voice_translation",
  configMode: "translation",
  /** 要客户端在 set_mode_config 里给的参数：目标语言（src/languages.mjs 的 id） */
  parameters: Object.freeze(["output_language"]),
  vocabulary: true,
  steps: Object.freeze(["native", "polish"]),
  /**
   * @param {{ output_language?: string }} parameters
   * 没给、不认识的语言抛错：服务端报成协议错误，不拿哪种语言硬译
   */
  bind({ output_language: wanted } = {}) {
    const language = findLanguage(wanted);
    if (language === null) {
      throw new Error(
        `output_language 要是 ${LANGUAGES.map(({ id }) => id).join(" / ")} 之一，现在是 ${JSON.stringify(wanted)}`,
      );
    }
    return Object.freeze({
      id: "translate",
      language: language.id,
      native: Object.freeze({
        system: (terms) => nativeTranslatePrompt(language, terms),
        reminder: nativeTranslateReminder(language),
        finish: (output) => translationFromModelOutput(output, language),
      }),
      polish: Object.freeze({
        system: (terms) => polishTranslatePrompt(language, terms),
        input: polishTranslateInput(language),
        finish: polishFinish(language),
      }),
    });
  },
});
