import { Converter } from "opencc-js/t2cn";
import { NO_SPEECH_MARK, SOURCE_TAG, TRANSLATION_TAG } from "./prompt.mjs";

// 模型回的话 → 成品：译文是要贴出去的，原文存进历史。
// 模型没照格式写的时候也要有东西可贴：没有译文的标签就把整段当译文（去掉原文那段和零散的标签），原文记成没有。

const toSimplified = Converter({ from: "t", to: "cn" });

/**
 * 某种目标语言的译文还要再收拾的：译成简体中文时，模型偶尔夹着繁体字（语音输入那边一长段里常冒出"這個"），
 * 同语音输入的收尾（../dictate/output.mjs）一样转成简体。别的语言照模型写的
 */
const POLISHERS = { "zh-CN": toSimplified };

/** 一段标签里的内容；没写收尾标签（被截断、漏写）时取到最后 */
const sectionOf = (text, tag) => text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*(?:</${tag}>|$)`))?.[1] ?? null;
const STRAY_TAGS = new RegExp(`</?(?:${SOURCE_TAG}|${TRANSLATION_TAG})>`, "g");
const SOURCE_SECTION = new RegExp(`<${SOURCE_TAG}>[\\s\\S]*?(?:</${SOURCE_TAG}>|$)`);

/**
 * @param {string | null | undefined} output 模型回的原话
 * @param {{ id: string }} language 目标语言
 * @returns {{ text: string, source: string | null }} 没有人声时 text 是空的
 */
export function translationFromModelOutput(output, language) {
  const raw = (output ?? "").trim();
  if (raw === "" || raw === NO_SPEECH_MARK) return { text: "", source: null };
  const translated = sectionOf(raw, TRANSLATION_TAG);
  const text = translated ?? raw.replace(SOURCE_SECTION, "").replace(STRAY_TAGS, "").trim();
  const source = sectionOf(raw, SOURCE_TAG);
  const polish = POLISHERS[language.id] ?? ((value) => value);
  return { text: text === NO_SPEECH_MARK ? "" : polish(text), source: source === "" ? null : source };
}
