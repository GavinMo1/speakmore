// 词典里的词：怎么规整、怎么算重复、导入的文件怎么拆。存在哪由 storage/vocabulary.mjs 管，
// 每个模型收多少、怎么收由 support.mjs 管。这里不碰文件和网络，主进程、命令行、页面都能直接用。

/** 一个词最多几个字（按码点算）。再长就不是一个词了，各家的热词也收不下（百炼一个中文热词最多 15 字） */
export const MAX_TERM_LENGTH = 50;

/** 词典最多几个词。各家能收的都比这少（智谱 100 个），多出来的只是排在后面、送不进去 */
export const MAX_TERMS = 1000;

/** Windows 上的记事本、Excel 存 UTF-8 时开头会带上它 */
const BOM = "\uFEFF";

/** 字数：按码点算，表情符号、生僻字算一个 */
export const termLength = (term) => [...term].length;

/** 规整：去掉控制字符，连着的空白（含换行、制表）并成一个空格，去掉首尾空白 */
export function normalizeTerm(raw) {
  return String(raw ?? "")
    .replace(/[\p{Cc}\s]+/gu, (run) => (/\s/u.test(run) ? " " : ""))
    .trim();
}

/**
 * 规整之后的词有什么问题：没问题是 null，否则是问题的名字（文案在 vocabulary.problems.<名字>）
 * @param {string} term 规整过的
 * @returns {"empty" | "tooLong" | null}
 */
export function termProblem(term) {
  if (term === "") return "empty";
  if (termLength(term) > MAX_TERM_LENGTH) return "tooLong";
  return null;
}

/** 认重复用的写法：大小写、全角半角不论（GitHub 和 github 是同一个词，留先加的那个写法） */
export const termKey = (term) => term.normalize("NFKC").toLowerCase();

/**
 * 导入的文件拆成词：一列的 CSV（原版的做法），或者一行一个词的文本。每行取第一列，空行跳过。
 * 第一列可以用引号括起来，里面的逗号不算分隔，两个引号是一个引号。
 * @param {string} text 文件的内容
 * @returns {{ terms: string[], duplicates: number, invalid: number }}
 *   terms：规整过、文件里不重复的词，按文件里的先后；duplicates：文件里重复的；invalid：太长的
 */
export function parseTermList(text) {
  const terms = [];
  const seen = new Set();
  let duplicates = 0;
  let invalid = 0;
  const content = String(text);
  for (const line of (content.startsWith(BOM) ? content.slice(1) : content).split(/\r\n|\r|\n/)) {
    const term = normalizeTerm(firstColumn(line));
    const problem = termProblem(term);
    if (problem === "empty") continue;
    if (problem !== null) {
      invalid += 1;
      continue;
    }
    if (seen.has(termKey(term))) {
      duplicates += 1;
      continue;
    }
    seen.add(termKey(term));
    terms.push(term);
  }
  return { terms, duplicates, invalid };
}

/** CSV 一行的第一列 */
function firstColumn(line) {
  const start = line.length - line.trimStart().length;
  if (line[start] !== '"') {
    const comma = line.indexOf(",");
    return comma === -1 ? line : line.slice(0, comma);
  }
  let value = "";
  for (let i = start + 1; i < line.length; i += 1) {
    if (line[i] !== '"') value += line[i];
    else if (line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else return value;
  }
  // 引号没有收尾：到行尾为止都算
  return value;
}
