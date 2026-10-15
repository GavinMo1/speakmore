// 用哪种语言：网址里的 ?lang= 最优先（分享链接时带上），其次是访客上次手动选的，最后看浏览器的语言。
// 只有英文和简体中文两种；中文的各种写法（zh、zh-TW、zh-Hans-CN）都落到简体中文，别的语言一律英文。

export const LOCALES = ["en", "zh-CN"];

/** 一个语言标签落到哪种页面语言；认不出来是 null */
export function matchLocale(tag) {
  if (typeof tag !== "string" || tag === "") return null;
  const lower = tag.toLowerCase();
  if (lower === "zh" || lower.startsWith("zh-")) return "zh-CN";
  if (lower === "en" || lower.startsWith("en-")) return "en";
  return null;
}

/**
 * @param {{ query?: string | null, stored?: string | null, languages?: readonly string[] }} sources
 * @returns {"en" | "zh-CN"}
 */
export function pickLocale({ query = null, stored = null, languages = [] }) {
  for (const candidate of [query, stored]) {
    const locale = matchLocale(candidate);
    if (locale) return locale;
  }
  // 浏览器给的是一串按偏好排好的语言，第一个认得出来的说了算
  for (const tag of languages) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return "en";
}

/** 切换按钮切到的那一种 */
export function otherLocale(locale) {
  return locale === "zh-CN" ? "en" : "zh-CN";
}
