import { LocalizedError, msg } from "./i18n/index.mjs";

// 翻译能译成的语言：只有这一张表。语音翻译、划词翻译的设置项，悬浮条上的语言胶囊，提示词里写的目标语言都按它来。
// id 用 BCP 47 的写法（en、zh-CN），存进设置、历史和协议（set_mode_config 的 output_language）的都是它。
// 给人看的名字按界面语言写，在文案里（languages.<id>）；prompt 是写进提示词的叫法：提示词是中文的，
// 后面带上英文名，模型认得更准。

export const LANGUAGES = Object.freeze(
  [
    { id: "en", prompt: "英语（English）" },
    { id: "zh-CN", prompt: "简体中文（Simplified Chinese）" },
    { id: "zh-TW", prompt: "繁体中文（Traditional Chinese）" },
    { id: "ja", prompt: "日语（Japanese）" },
    { id: "ko", prompt: "韩语（Korean）" },
    { id: "fr", prompt: "法语（French）" },
    { id: "de", prompt: "德语（German）" },
    { id: "es", prompt: "西班牙语（Spanish）" },
    { id: "pt", prompt: "葡萄牙语（Portuguese）" },
    { id: "it", prompt: "意大利语（Italian）" },
    { id: "ru", prompt: "俄语（Russian）" },
    { id: "ar", prompt: "阿拉伯语（Arabic）" },
    { id: "vi", prompt: "越南语（Vietnamese）" },
    { id: "th", prompt: "泰语（Thai）" },
    { id: "id", prompt: "印尼语（Indonesian）" },
    { id: "tr", prompt: "土耳其语（Turkish）" },
  ].map(Object.freeze),
);

/** 这个 id 的语言，大小写不论（zh-cn 也认）；不认识的是 null */
export function findLanguage(id) {
  const wanted = String(id ?? "")
    .trim()
    .toLowerCase();
  return LANGUAGES.find((language) => language.id.toLowerCase() === wanted) ?? null;
}

/** 用户写的语言 → 规整的 id。不认识就抛 LocalizedError，列出能填的 */
export function parseLanguage(value) {
  const language = findLanguage(value);
  if (language === null) {
    throw new LocalizedError(msg("settings.oneOf", { choices: LANGUAGES.map(({ id }) => id).join(" / ") }));
  }
  return language.id;
}

/** 语言的名字：一句还没定语言的话（英文、English） */
export const languageName = (id) => msg(`languages.${id}`);
