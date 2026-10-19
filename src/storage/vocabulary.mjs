import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LocalizedError, msg } from "../i18n/index.mjs";
import {
  MAX_TERM_LENGTH,
  MAX_TERMS,
  normalizeTerm,
  parseTermList,
  termKey,
  termProblem,
} from "../vocabulary/terms.mjs";

// 用户的词典：只存在本机数据目录的 vocabulary.json 里，不上传到任何地方。每次听写时读出来，
// 按路线上每个模型的收法送过去（vocabulary/support.mjs）。后台应用和命令行用的是同一份文件和同一份代码。
//
//   { "terms": ["Claude Code", "埋点", …] }
//
// 先后就是词典页上的先后，也是送词的优先顺序（各家收的个数有上限）：新加的、导入的放在最前面。
// 手改文件也认：读的时候照样规整、去重，空的丢掉。

/**
 * @param {string} file 词典文件（storage/paths.mjs 的 vocabularyFile）
 */
export function openVocabulary(file) {
  /** 上次读到的：文件没变（修改时间和大小都一样）就不再读 */
  let cached = null;

  function read() {
    if (!existsSync(file)) {
      cached = null;
      return [];
    }
    const { mtimeMs, size } = statSync(file);
    const version = `${mtimeMs}:${size}`;
    if (cached?.version === version) return cached.terms;
    let stored;
    try {
      stored = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      throw new LocalizedError(msg("vocabulary.unreadable", { file, reason: error.message }), { cause: error });
    }
    if (!Array.isArray(stored?.terms) || stored.terms.some((term) => typeof term !== "string")) {
      throw new LocalizedError(msg("vocabulary.malformed", { file }));
    }
    const seen = new Set();
    const terms = [];
    for (const raw of stored.terms) {
      const term = normalizeTerm(raw);
      if (term === "" || seen.has(termKey(term))) continue;
      seen.add(termKey(term));
      terms.push(term);
    }
    cached = { version, terms: Object.freeze(terms) };
    return cached.terms;
  }

  function write(terms) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ terms }, null, 2)}\n`);
  }

  /** 规整并检查一个要加进来的词：有问题照实说 */
  function checked(raw) {
    const term = normalizeTerm(raw);
    const problem = termProblem(term);
    if (problem) throw new LocalizedError(msg(`vocabulary.problems.${problem}`, { max: MAX_TERM_LENGTH }));
    return term;
  }

  const indexOf = (terms, term) => terms.findIndex((existing) => termKey(existing) === termKey(term));

  return {
    /** 词典里的词，按先后。文件坏了抛 LocalizedError，不当成空词典 */
    terms: read,

    /** 加一个词，放在最前面。@returns 规整后的写法 */
    add(raw) {
      const terms = read();
      const term = checked(raw);
      const existing = indexOf(terms, term);
      if (existing !== -1) throw new LocalizedError(msg("vocabulary.duplicate", { term: terms[existing] }));
      if (terms.length >= MAX_TERMS) throw new LocalizedError(msg("vocabulary.full", { max: MAX_TERMS }));
      write([term, ...terms]);
      return term;
    },

    /** 改一个词，位置不变。只改大小写也算改。@returns 规整后的写法 */
    update(previous, raw) {
      const terms = read();
      const at = indexOf(terms, previous);
      if (at === -1) throw new LocalizedError(msg("vocabulary.notFound", { term: previous }));
      const term = checked(raw);
      const clash = indexOf(terms, term);
      if (clash !== -1 && clash !== at) throw new LocalizedError(msg("vocabulary.duplicate", { term: terms[clash] }));
      write(terms.map((existing, i) => (i === at ? term : existing)));
      return term;
    },

    /** 删掉这几个词（大小写不论）。@returns 删了几个，不在词典里的不算 */
    remove(list) {
      const terms = read();
      const gone = new Set(list.map((term) => termKey(normalizeTerm(term))));
      const kept = terms.filter((term) => !gone.has(termKey(term)));
      if (kept.length !== terms.length) write(kept);
      return terms.length - kept.length;
    },

    /**
     * 导入前先看看：文件里有哪些词能加（去掉词典里已有的）、重复几个、无效几个，词典还能放几个
     * @param {string} text 导入的文件内容（一列的 CSV，或一行一个词）
     */
    preview(text) {
      const terms = read();
      const parsed = parseTermList(text);
      const fresh = parsed.terms.filter((term) => indexOf(terms, term) === -1);
      return {
        terms: fresh,
        duplicates: parsed.duplicates + parsed.terms.length - fresh.length,
        invalid: parsed.invalid,
        room: MAX_TERMS - terms.length,
      };
    },

    /**
     * 导入预览过的词，按给的先后加在最前面。这期间又有了的跳过；放不下就整批不导，说清还能加几个
     * @param {readonly string[]} list
     * @returns {number} 加了几个
     */
    importTerms(list) {
      const terms = read();
      const seen = new Set(terms.map(termKey));
      const fresh = [];
      for (const raw of list) {
        const term = checked(raw);
        if (seen.has(termKey(term))) continue;
        seen.add(termKey(term));
        fresh.push(term);
      }
      if (terms.length + fresh.length > MAX_TERMS) {
        throw new LocalizedError(
          msg("vocabulary.tooMany", { max: MAX_TERMS, room: MAX_TERMS - terms.length, count: fresh.length }),
        );
      }
      if (fresh.length > 0) write([...fresh, ...terms]);
      return fresh.length;
    },
  };
}
