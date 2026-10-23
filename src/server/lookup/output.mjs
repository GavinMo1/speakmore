import { Converter } from "opencc-js/t2cn";

// 模型回的话 → 卡片上的译文。提示词让它只输出译文，偶尔还是会套上标签：去掉。

const toSimplified = Converter({ from: "t", to: "cn" });

/** 某种目标语言的译文还要再收拾的：译成简体中文时模型偶尔夹着繁体字，转成简体（同语音翻译的收尾，各写各的） */
const POLISHERS = { "zh-CN": toSimplified };
const STRAY_TAGS = /<\/?(?:选中文字|译文)>/g;

/**
 * @param {string | null | undefined} output 模型回的原话
 * @param {{ id: string }} language 目标语言
 */
export function translationOf(output, language) {
  const text = (output ?? "").replace(STRAY_TAGS, "").trim();
  return (POLISHERS[language.id] ?? ((value) => value))(text);
}
