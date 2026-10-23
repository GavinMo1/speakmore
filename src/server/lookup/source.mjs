import { Converter as toTraditionalConverter } from "opencc-js/cn2t";
import { Converter as toSimplifiedConverter } from "opencc-js/t2cn";

// 选中的字是不是已经是目标语言（是的话改译成另一种，见 prompt.mjs 的 fallbackOf）。
// 让模型自己判断不可靠（10-22 实测 DeepSeek V4.1 Flash：中文原文、目标中文时它改写中文；英文原文、目标英语时照抄；
// 用户消息里写上"已经是就译成英语"，英文原文、目标日语时又译成了英语），所以在代码里判断：
//   文字系统分得清的（中文、日文假名、韩文、俄文、阿拉伯文、泰文）发请求前就认出来；繁简另看，繁体选给简体是要转写。
//   英语看虚词（the、you、of……）占的比例；别的拉丁字母语言分不出，先照常译，译出来和原文几乎一样再改译（looksUntranslated）。
//   中文目标遇上以汉字为主的原文，认出"不是"也作数：繁简转写、日文汉字转简体，译文和原文本来就有八成字相同，
//   再拿重合率判会当成照抄、改译成英文（10-23 审查实测"我想去北京看看天安門"被改成了英文）。

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

/** 比占比用的单位：中日韩、泰文一个字一个，别的文字一个词一个（中文里夹的 API、response 各算一个，不按字母数） */
const LETTER_UNITS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]|[^\P{L}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]+/gu;

/** 每个单位是哪种文字系统，数一数（数字、标点不算） */
function countScripts(text) {
  const counts = Object.fromEntries(Object.keys(SCRIPTS).map((name) => [name, 0]));
  const units = text.match(LETTER_UNITS) ?? [];
  for (const unit of units) {
    const name = Object.keys(SCRIPTS).find((script) => SCRIPTS[script].test(unit));
    if (name) counts[name]++;
  }
  return { counts, letters: units.length };
}

/** 这种文字系统的单位过半 */
const mostly = ({ counts, letters }, name) => letters > 0 && counts[name] / letters > 0.5;

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

/** 中文的两种写法各自怎么转 */
const CONVERTERS = { "zh-CN": toSimplified, "zh-TW": toTraditional };

/** 中文目标遇上以汉字为主、没有假名、转成目标写法会改字的原文：是另一种写法（繁简、日文汉字），要转写，"不是"作数 */
const decidesNo = (text, language, scripts) =>
  language in CONVERTERS &&
  mostly(scripts, "han") &&
  scripts.counts.kana === 0 &&
  CONVERTERS[language](text) !== text;

/**
 * 选中的字是不是已经是这种语言
 * @param {string} text
 * @param {string} language 语言 id（src/languages.mjs）
 * @returns {boolean | null} true 已经是；false 肯定不是；null 认不出，译完再看像不像原文（looksUntranslated）
 */
export function sourceIs(text, language) {
  const recognize = RECOGNIZERS[language];
  const scripts = countScripts(text);
  if (recognize?.(text, scripts)) return true;
  return decidesNo(text, language, scripts) ? false : null;
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
