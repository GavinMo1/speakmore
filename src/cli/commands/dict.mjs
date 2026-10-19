import { readFileSync, statSync } from "node:fs";
import { LocalizedError, msg, problemOf } from "../../i18n/index.mjs";
import { openVocabulary } from "../../storage/vocabulary.mjs";
import { parse, say, UsageError } from "../common.mjs";

// speakmore dict：看、加、删、导入词典。词典只是本机的一个文件（storage/vocabulary.mjs），这里直接读写，
// 不经过后台应用：后台每次听写时重读一次，改完下一句话就用上。

/** 导入的文件最大多少：同词典页（一列的 CSV，5 MB） */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const usage = () => new UsageError(msg("cli.dict.usage"));

export async function dict(args, io) {
  const { values, positionals } = parse(args, { json: { type: "boolean", default: false } });
  const [action, ...rest] = positionals;
  const vocabulary = openVocabulary(io.paths.vocabularyFile);

  if (action === undefined) {
    const terms = vocabulary.terms();
    if (values.json) io.out(JSON.stringify(terms));
    else if (terms.length === 0) say(io, msg("cli.dict.empty"));
    else {
      say(io, msg("cli.dict.header", { count: terms.length, file: io.paths.vocabularyFile }));
      for (const term of terms) io.out(`  ${term}`);
    }
    return 0;
  }

  if (action === "add") {
    if (rest.length === 0) throw usage();
    // 一个一个加：重复、太长的说清楚，其余照加
    let failed = 0;
    for (const raw of rest) {
      try {
        say(io, msg("cli.dict.added", { term: vocabulary.add(raw) }));
      } catch (error) {
        if (!(error instanceof LocalizedError)) throw error;
        failed += 1;
        io.err(io.t("cli.dict.notAdded", { term: raw.trim(), reason: io.t.text(error.problem) }));
      }
    }
    return failed > 0 ? 1 : 0;
  }

  if (action === "remove") {
    if (rest.length === 0) throw usage();
    const count = vocabulary.remove(rest);
    if (count === 0) {
      io.err(io.t.text(msg("vocabulary.notFound", { term: rest.join("、") })));
      return 1;
    }
    say(io, msg("cli.dict.removed", { count }));
    return 0;
  }

  if (action === "import") {
    if (rest.length !== 1) throw usage();
    const [file] = rest;
    let text;
    try {
      if (statSync(file).size > MAX_IMPORT_BYTES) {
        throw new LocalizedError(msg("vocabulary.fileTooLarge", { max: MAX_IMPORT_BYTES / 1024 / 1024 }));
      }
      text = readFileSync(file, "utf8");
    } catch (error) {
      throw new LocalizedError(msg("cli.dict.unreadable", { file, reason: io.t.text(problemOf(error)) }), {
        cause: error,
      });
    }
    const preview = vocabulary.preview(text);
    const added = vocabulary.importTerms(preview.terms);
    say(io, msg("cli.dict.imported", { count: added, duplicates: preview.duplicates, invalid: preview.invalid }));
    return 0;
  }

  throw usage();
}
