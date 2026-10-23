import { msg } from "../../../i18n/index.mjs";
import { languageName } from "../../../languages.mjs";

// 悬浮条上的语音翻译：译成设置里排第一的那种（translate.to）；提示行左边一个语言胶囊，悬停展开设置里那几种，
// 临时换的只管这一次，下次开口又回到第一种。等成品时写"翻译中"。接口见 index.mjs

export const translate = Object.freeze({
  id: "translate",
  mode: "voice_translation",
  configMode: "translation",
  /** @param {{ translateTo: string[] }} config 开口时主进程现读的设置 */
  open: ({ translateTo }) => Object.freeze({ targets: translateTo, language: translateTo[0] }),
  parameters: (state) => ({ output_language: state.language }),
  chip: (state) => ({
    text: languageName(state.language),
    options: state.targets.map((id) => ({ id, text: languageName(id), selected: id === state.language })),
  }),
  pick: (state, id) => (state.targets.includes(id) ? Object.freeze({ ...state, language: id }) : state),
  finishing: msg("bar.translating"),
  delivered: (state, result) => ({ sourceText: result.source, outputLanguage: state.language }),
});
