import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { LocalizedError, msg } from "../i18n/index.mjs";
import {
  decodeImport,
  MAX_IMPORT_BYTES,
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
// 手改文件也认：读的时候照样规整、去重，空的丢掉，开头带 BOM 也认。
//
// 写是原子的（先写临时文件再换上去）：听写时读不到写了一半的词典，写到一半断电也不会把它弄坏。
// 两个进程（后台应用和命令行）同时改的话后写的会盖掉先写的；不加跨进程的锁：改之前都重新读一遍，
// 撞上的窗口只有几毫秒，一个人用的词典碰不上。

/** Windows 上目标文件正被别的程序开着（杀毒软件扫描、搜索索引）时换不上，报的是这几种，过一会儿就好 */
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);
/** 被拒后隔多久再试（毫秒），合计约半秒：写词典是在主进程里同步做的，等太久界面会卡 */
const RETRY_WAITS = [10, 20, 40, 80, 160, 250];

/**
 * 把写好的临时文件换成正式的。Windows 上目标正被别的程序开着时会被拒（别的程序允许删除共享也一样），
 * 隔一会儿再试（graceful-fs 也是这么做的）；别的系统、别的错误照原样抛
 */
export function replaceFile(from, to, { rename = renameSync, platform = process.platform, waits = RETRY_WAITS } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      if (platform !== "win32" || attempt >= waits.length || !BUSY.has(error?.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waits[attempt]);
    }
  }
}

/** 读写文件出错时给人看的原因：常见的几种照这种语言说，别的给错误代码 */
const fileReason = (error) =>
  ["ENOENT", "EACCES", "EPERM", "EISDIR"].includes(error?.code)
    ? msg(`vocabulary.fileErrors.${error.code}`)
    : (error?.code ?? String(error?.message ?? error));

/**
 * @param {string} file 词典文件（storage/paths.mjs 的 vocabularyFile）
 */
export function openVocabulary(file) {
  /** 上次读到的：文件没变（修改时间和大小都一样）就不再读。自己写过之后记下写进去的 */
  let cached = null;

  /** @param {{ fresh?: boolean }} [options] fresh：不看缓存，改词典之前用，免得基于旧的内容写回去 */
  function read({ fresh = false } = {}) {
    if (!existsSync(file)) {
      cached = null;
      return [];
    }
    const { mtimeMs, size } = statSync(file);
    const version = `${mtimeMs}:${size}`;
    if (!fresh && cached?.version === version) return cached.terms;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      throw new LocalizedError(msg("vocabulary.unreadable", { file, reason: fileReason(error) }), { cause: error });
    }
    let stored;
    try {
      stored = JSON.parse(text.startsWith("﻿") ? text.slice(1) : text);
    } catch (error) {
      // 不带 JSON 的报错原文：那里面有词典的内容，这句话会进日志
      throw new LocalizedError(msg("vocabulary.malformed", { file }), { cause: error });
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
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, `${JSON.stringify({ terms }, null, 2)}\n`, { mode: 0o600 });
      replaceFile(temporary, file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw new LocalizedError(msg("vocabulary.unwritable", { file, reason: fileReason(error) }), { cause: error });
    }
    const { mtimeMs, size } = statSync(file);
    cached = { version: `${mtimeMs}:${size}`, terms: Object.freeze([...terms]) };
  }

  /** 规整并检查一个要加进来的词：有问题照实说 */
  function checked(raw) {
    const term = normalizeTerm(raw);
    const problem = termProblem(term);
    if (problem) throw new LocalizedError(msg(`vocabulary.problems.${problem}`, { max: MAX_TERM_LENGTH }));
    return term;
  }

  const indexOf = (terms, term) => terms.findIndex((existing) => termKey(existing) === termKey(term));
  /** 还能加几个。手改文件可能超过上限：那就是 0，不是负数 */
  const roomOf = (terms) => Math.max(0, MAX_TERMS - terms.length);

  return {
    /** 词典里的词，按先后。文件坏了抛 LocalizedError，不当成空词典 */
    terms: () => read(),

    /** 加一个词，放在最前面。@returns 规整后的写法 */
    add(raw) {
      const terms = read({ fresh: true });
      const term = checked(raw);
      const existing = indexOf(terms, term);
      if (existing !== -1) throw new LocalizedError(msg("vocabulary.duplicate", { term: terms[existing] }));
      if (roomOf(terms) === 0) throw new LocalizedError(msg("vocabulary.full", { max: MAX_TERMS }));
      write([term, ...terms]);
      return term;
    },

    /** 改一个词，位置不变。只改大小写也算改。@returns 规整后的写法 */
    update(previous, raw) {
      const terms = read({ fresh: true });
      const at = indexOf(terms, previous);
      if (at === -1) throw new LocalizedError(msg("vocabulary.notFound", { term: previous }));
      const term = checked(raw);
      const clash = indexOf(terms, term);
      if (clash !== -1 && clash !== at) throw new LocalizedError(msg("vocabulary.duplicate", { term: terms[clash] }));
      write(terms.map((existing, i) => (i === at ? term : existing)));
      return term;
    },

    /**
     * 删掉这几个词（大小写不论）
     * @returns {{ removed: number, missing: string[] }} 删了几个；哪些本来就不在词典里（原样）
     */
    remove(list) {
      const terms = read({ fresh: true });
      const present = new Set(terms.map(termKey));
      const missing = list.filter((term) => !present.has(termKey(normalizeTerm(term))));
      const gone = new Set(list.map((term) => termKey(normalizeTerm(term))));
      const kept = terms.filter((term) => !gone.has(termKey(term)));
      if (kept.length !== terms.length) write(kept);
      return { removed: terms.length - kept.length, missing };
    },

    /**
     * 导入前先看看：文件里有哪些词能加，已在词典里的、文件里自己重复的、无效的各几个，词典还能放几个
     * @param {string} text 导入的文件内容（一列的 CSV，或一行一个词）
     */
    preview(text) {
      const terms = read();
      const parsed = parseTermList(text);
      const fresh = parsed.terms.filter((term) => indexOf(terms, term) === -1);
      return {
        terms: fresh,
        existing: parsed.terms.length - fresh.length,
        duplicates: parsed.duplicates,
        invalid: parsed.invalid,
        room: roomOf(terms),
      };
    },

    /**
     * 导入预览过的词，按给的先后加在最前面。这期间又有了的跳过；放不下就整批不导，说清还能加几个
     * @param {readonly string[]} list
     * @returns {number} 加了几个
     */
    importTerms(list) {
      const terms = read({ fresh: true });
      const seen = new Set(terms.map(termKey));
      const fresh = [];
      for (const raw of list) {
        const term = checked(raw);
        if (seen.has(termKey(term))) continue;
        seen.add(termKey(term));
        fresh.push(term);
      }
      if (fresh.length > roomOf(terms)) {
        throw new LocalizedError(
          msg("vocabulary.tooMany", { max: MAX_TERMS, room: roomOf(terms), count: fresh.length }),
        );
      }
      if (fresh.length > 0) write([...fresh, ...terms]);
      return fresh.length;
    },
  };
}

/**
 * 读要导入的文件：最多读 MAX_IMPORT_BYTES，多了就停（管道、命名管道没有大小，不能只看 stat），按编码解成文字。
 * 读不出、太大、不是文本都抛 LocalizedError，说清是哪个文件
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function readImportFile(path) {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
      total += chunk.length;
      if (total > MAX_IMPORT_BYTES) {
        throw new LocalizedError(msg("vocabulary.fileTooLarge", { max: MAX_IMPORT_BYTES / 1024 / 1024 }));
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof LocalizedError) throw error;
    throw new LocalizedError(msg("vocabulary.importUnreadable", { file: path, reason: fileReason(error) }), {
      cause: error,
    });
  }
  const text = decodeImport(Buffer.concat(chunks));
  if (text === null) throw new LocalizedError(msg("vocabulary.notText", { file: path }));
  return text;
}
