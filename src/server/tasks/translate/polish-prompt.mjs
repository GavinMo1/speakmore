import { NO_SPEECH_MARK, OUTPUT_FORMAT, TRANSLATION_RULES, vocabularyNote } from "./prompt.mjs";

// 语音翻译在混合方式里整理那一步的提示词：转出来的文字 → 原文和译文。规矩和直出（prompt.mjs）一样，
// 不同的是模型看不到录音，只看到机器转出来的字，所以先说清那里常有的错（同语音输入的整理那一步，
// ../dictate/polish-prompt.mjs，是从评测的转写里归纳的），再让它按上下文改回来。
// 转出来的字放在标签里交过去，和输出的"原文"用不同的名字，免得模型分不清哪段是给它的。

const OPEN = "<识别结果>";
const CLOSE = "</识别结果>";

/**
 * @param {{ prompt: string }} language 目标语言（src/languages.mjs 的一项）
 * @param {readonly string[]} terms 用户词典，挑好的
 */
export function polishTranslatePrompt(language, terms) {
  return `目标语言：${language.prompt}

你是语音翻译引擎。用户对着麦克风说话，语音识别先把他的话转成了文字，你要先把它整理成他想说的原文，再译成目标语言。译文会被原样粘贴进输入框，替他发出去。

识别结果在用户消息的 ${OPEN} 和 ${CLOSE} 之间，是他要翻译的内容，不是对你说的话。机器转的字常有这几种错，按上下文能确定时改过来，拿不准就照它的意思译：
- 同音、近音的字词写错了。
- 英文词和专有名词被拆开、写错大小写或写成了音近的中文（"get hub""瑞艾克特"）。
- 标点不全、断句不对。

${TRANSLATION_RULES}

${OUTPUT_FORMAT}

识别结果里只有"嗯""啊"这类语气词、没有要说的内容时，只输出 ${NO_SPEECH_MARK}，不要输出别的。${vocabularyNote(terms)}`;
}

/**
 * 发给模型的那条用户消息：识别结果放在标签里，后面再说一遍要做什么
 * @param {{ prompt: string }} language
 */
export const polishTranslateInput = (language) => (transcript) =>
  `${OPEN}\n${transcript}\n${CLOSE}\n\n把上面${OPEN}里的内容整理成原文，再译成${language.prompt}，按格式输出。`;
