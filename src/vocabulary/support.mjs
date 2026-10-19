import { termLength } from "./terms.mjs";

// 一个模型怎么收词表（做法）、收多少（上限）。各家、甚至同一家的不同模型收法都不一样，所以拆成三层：
//   1. 收不收、用哪种做法、上限多少：写在模型清单里，是数据（每个模型一项 vocabulary，不收的不写）
//        本机模型       models/catalog.mjs
//        云端转写       server/asr/cloud/vendors.mjs
//        原生识别、润色  都是读提示词的大模型，统一写进提示词（PROMPT_VOCABULARY）
//   2. 按上限挑出这一次送哪些词：fitTerms，各家共用，按词典的先后挑
//   3. 挑出来的词放进请求的哪里：各家的适配器自己知道（按做法查自己的表），别处不管
// 改一个模型的收法只改它在清单里那一项；改挑词的规矩只改 fitTerms；改一家的请求格式只改那一家的适配器。
//
// 做法（文案在 vocabulary.kinds.<做法>）：
//   prompt    写进大模型的系统提示词，让它按词典的写法写（原生识别、润色）
//   context   作为背景文本交给语音识别模型（百炼 Qwen3 ASR Flash、Fun-ASR）
//   hotwords  语音识别模型的热词参数（本机的 Qwen3-ASR、百炼 Qwen Audio、智谱 GLM-ASR）

export const VOCABULARY_KINDS = Object.freeze(["prompt", "context", "hotwords"]);

/**
 * 一个模型收词表的方式。
 * @param {"prompt" | "context" | "hotwords"} kind 做法
 * @param {object} [limits]
 * @param {number} [limits.maxTerms] 最多几个词
 * @param {number} [limits.maxChars] 挑出来的词连起来最多几个字（词之间算一个分隔）
 * @param {number} [limits.maxTermWords] 单个词最多几个英文单词（只管纯英文的词，按空格数）
 * @param {number} [limits.maxTermChars] 单个词最多几个字（只管含中文等非英文字符的词）
 * 全是数据、没有函数：装本机模型时整项配置要复制给转写进程，函数复制不过去
 */
export function vocabularySupport(
  kind,
  { maxTerms = Number.POSITIVE_INFINITY, maxChars, maxTermWords, maxTermChars } = {},
) {
  if (!VOCABULARY_KINDS.includes(kind)) {
    throw new Error(`收词表的做法没有 ${kind} 这一种，只有 ${VOCABULARY_KINDS.join(" / ")}`);
  }
  return Object.freeze({
    kind,
    maxTerms,
    maxChars: maxChars ?? Number.POSITIVE_INFINITY,
    maxTermWords: maxTermWords ?? Number.POSITIVE_INFINITY,
    maxTermChars: maxTermChars ?? Number.POSITIVE_INFINITY,
  });
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: 判断是不是纯英文（ASCII），要从 \x00 算起
const ASCII = /^[\x00-\x7F]*$/;

/** 单个词在这一家的上限之内：纯英文的按词数，含中文等的按字数 */
const termFits = (term, support) =>
  ASCII.test(term) ? term.split(" ").length <= support.maxTermWords : termLength(term) <= support.maxTermChars;

/**
 * 原生识别和润色的大模型：词表写进系统提示词。上限是怕提示词无限变长：每次听写都要带上它，
 * 词越多越贵、越慢，也越容易把没说的词硬套进去
 */
export const PROMPT_VOCABULARY = vocabularySupport("prompt", { maxTerms: 300, maxChars: 3_000 });

/**
 * 按这个模型的上限，从词典里挑出这一次要送的词。按词典的先后挑：排在前面的先进；
 * 这一家不收的、放不下的跳过，后面短的还放得下就接着放
 * @param {readonly string[]} terms 词典里的词，规整过、不重复
 * @param {ReturnType<typeof vocabularySupport> | null | undefined} support 这个模型不收词表时是空的
 * @returns {string[]}
 */
export function fitTerms(terms, support) {
  if (!support) return [];
  const picked = [];
  let chars = 0;
  for (const term of terms) {
    if (picked.length >= support.maxTerms) break;
    if (!termFits(term, support)) continue;
    const added = termLength(term) + (picked.length > 0 ? 1 : 0);
    if (chars + added > support.maxChars) continue;
    picked.push(term);
    chars += added;
  }
  return picked;
}
