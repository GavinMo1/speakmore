import { Converter as toTraditionalConverter } from "opencc-js/cn2t";
import { Converter as toSimplifiedConverter } from "opencc-js/t2cn";

// 选中的字是不是已经是目标语言（是的话改译成另一种，见 prompt.mjs 的 fallbackOf）。
// 让模型自己判断不可靠（10-22 实测 DeepSeek V4.1 Flash：中文原文、目标中文时它改写中文；英文原文、目标英语时照抄；
// 用户消息里写上"已经是就译成英语"，英文原文、目标日语时又译成了英语），所以在代码里判断：
//   文字系统分得清的（中文、日文假名、韩文、俄文、阿拉伯文、泰文）发请求前就认出来；繁简另看，繁体选给简体是要转写。
//   英语看虚词（the、you、of……）占的比例；别的拉丁字母语言分不出，先照常译，译出来和原文几乎一样再改译（looksUntranslated）。

const toSimplified = toSimplifiedConverter({ from: "t", to: "cn" });
const toTraditional = toTraditionalConverter({ from: "cn", to: "tw" });

/** 几种文字系统的字。日文看假名：有汉字也有假名的是日文 */
const SCRIPTS = {
  han: /\p{Script=Han}/u,
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
  hangul: /\p{Script=Hangul}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  arabic: /\p{Script=Arabic}/u,
  thai: /\p{Script=Thai}/u,
  latin: /\p{Script=Latin}/u,
};

/** 每个字母是哪种文字系统，数一数 */
function countScripts(text) {
  const counts = Object.fromEntries(Object.keys(SCRIPTS).map((name) => [name, 0]));
  let letters = 0;
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue;
    letters++;
    for (const [name, pattern] of Object.entries(SCRIPTS)) {
      if (pattern.test(char)) {
        counts[name]++;
        break;
      }
    }
  }
  return { counts, letters };
}

/** 这种文字系统占了字母的大半（拉丁字母夹在中文里的 bug、API 这种不算数） */
const mostly = ({ counts, letters }, name) => letters > 0 && counts[name] / letters >= 0.6;

/** 英文里最常见的虚词：一段话里占到四分之一以上，多半是英文 */
const ENGLISH_WORDS = new Set(
  "the a an and or but of to in on at by for from with as is are was were be been it its this that these those you your we our us they their he she i me my not no do does did can could will would should have has had if so than then there what which who how".split(
    " ",
  ),
);

function looksEnglish(text) {
  const words = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  if (words.length < 3) return false;
  // 带重音字母（é、ü、ñ）的多半是别的拉丁字母语言
  if (/[à-öø-ÿ]/i.test(text)) return false;
  const common = words.filter((word) => ENGLISH_WORDS.has(word.replace(/'.*$/, ""))).length;
  return common / words.length >= 0.25;
}

/** 每种语言怎么认：认不出的语言没有这一项，交给 looksUntranslated */
const RECOGNIZERS = {
  // 中文：汉字占大半、没有假名，并且繁简和目标一致（简体转成简体不变才是简体）
  "zh-CN": (text, scripts) => mostly(scripts, "han") && scripts.counts.kana === 0 && toSimplified(text) === text,
  "zh-TW": (text, scripts) =>
    mostly(scripts, "han") && scripts.counts.kana === 0 && toTraditional(text) === text && toSimplified(text) !== text,
  ja: (_text, scripts) => scripts.counts.kana > 0 && scripts.counts.kana + scripts.counts.han >= scripts.letters * 0.6,
  ko: (_text, scripts) => mostly(scripts, "hangul"),
  ru: (_text, scripts) => mostly(scripts, "cyrillic"),
  ar: (_text, scripts) => mostly(scripts, "arabic"),
  th: (_text, scripts) => mostly(scripts, "thai"),
  en: (text, scripts) => mostly(scripts, "latin") && looksEnglish(text),
};

/**
 * 选中的字是不是已经是这种语言（认得出才说是；认不出的一律不是）
 * @param {string} text
 * @param {string} language 语言 id（src/languages.mjs）
 */
export function sourceIs(text, language) {
  const recognize = RECOGNIZERS[language];
  return recognize ? recognize(text, countScripts(text)) : false;
}

/** 拆成比较用的单位：拉丁、西里尔这类按词，中日韩、泰文按字 */
const unitsOf = (text) =>
  text
    .toLowerCase()
    .match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]|[\p{L}\p{N}']+/gu) ??
  [];

/**
 * 译出来的和原文几乎一样：多半是原文就是目标语言、模型照抄（或只改了一两个词）。标点、大小写、空白不算
 * @param {string} source
 * @param {string} output
 */
export function looksUntranslated(source, output) {
  const from = unitsOf(source);
  const to = unitsOf(output);
  if (to.length === 0) return false;
  const known = new Set(from);
  const shared = to.filter((unit) => known.has(unit)).length;
  return shared / to.length >= 0.8 && to.length <= from.length * 1.3 && from.length <= to.length * 1.3;
}
