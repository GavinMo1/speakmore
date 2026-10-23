import assert from "node:assert/strict";
import { test } from "node:test";
import { findLanguage, LANGUAGES } from "../../../../src/languages.mjs";
import { findTask } from "../../../../src/server/tasks/index.mjs";
import { translationFromModelOutput } from "../../../../src/server/tasks/translate/output.mjs";
import { NO_SPEECH_MARK } from "../../../../src/server/tasks/translate/prompt.mjs";

const translate = findTask("translate");
const english = findLanguage("en");

test("目标语言写在提示词的第一行：换一种语言，下一次拼出来的就是新的", () => {
  for (const id of ["en", "ja", "zh-TW"]) {
    const bound = translate.bind({ output_language: id });
    const { prompt } = findLanguage(id);
    assert.equal(bound.native.system([]).split("\n")[0], `目标语言：${prompt}`);
    assert.equal(bound.polish.system([]).split("\n")[0], `目标语言：${prompt}`);
    // 跟在录音、识别结果后面的那句话里再说一遍
    assert.ok(bound.native.reminder.includes(prompt));
    assert.ok(bound.polish.input("你好").includes(prompt));
  }
});

test("用词典：接在两步提示词的最后、一行一个；词典是空的时提示词里没有这一段", () => {
  const bound = translate.bind({ output_language: "en" });
  for (const step of [bound.native, bound.polish]) {
    const plain = step.system([]);
    assert.ok(!plain.includes("用户词典"));
    const prompt = step.system(["Runzo", "埋点"]);
    assert.ok(prompt.startsWith(plain));
    assert.match(prompt.slice(plain.length), /用户词典[\s\S]*\nRunzo\n埋点$/);
  }
});

test("提示词里的无人声标记和收尾认的是同一个；识别结果放在标签里交过去", () => {
  const bound = translate.bind({ output_language: "en" });
  assert.ok(bound.native.system([]).includes(`只输出 ${NO_SPEECH_MARK}，`));
  assert.ok(bound.polish.system([]).includes(`只输出 ${NO_SPEECH_MARK}，`));
  assert.ok(bound.polish.input("我们后天开会").includes("<识别结果>\n我们后天开会\n</识别结果>"));
});

test("目标语言要给、要认识：没给或者不认识就抛错，不拿哪种语言硬译；大小写不论", () => {
  assert.throws(() => translate.bind({}), /output_language/);
  assert.throws(() => translate.bind({ output_language: "klingon" }), /output_language/);
  assert.equal(translate.bind({ output_language: "ZH-cn" }).language, "zh-CN");
  assert.deepEqual(translate.parameters, ["output_language"]);
  // 离线没有能翻译的模型
  assert.deepEqual(translate.steps, ["native", "polish"]);
});

test("收尾：译文贴出去，原文存下；没照格式写时整段当译文", () => {
  const output =
    "<原文>\n我们后天下午开会。\n</原文>\n<译文>\nLet's meet the day after tomorrow in the afternoon.\n</译文>";
  assert.deepEqual(translationFromModelOutput(output, english), {
    text: "Let's meet the day after tomorrow in the afternoon.",
    source: "我们后天下午开会。",
  });
  // 只写了译文的标签、没写原文
  assert.deepEqual(translationFromModelOutput("<译文>Hello</译文>", english), { text: "Hello", source: null });
  // 一个标签都没有
  assert.deepEqual(translationFromModelOutput("  Hello there  ", english), { text: "Hello there", source: null });
  // 收尾标签漏了（被截断）
  assert.deepEqual(translationFromModelOutput("<原文>你好</原文>\n<译文>\nHello", english), {
    text: "Hello",
    source: "你好",
  });
  // 有原文、没有译文的标签：去掉原文那段，剩下的当译文
  assert.deepEqual(translationFromModelOutput("<原文>你好</原文>\nHello", english), { text: "Hello", source: "你好" });
});

test("收尾：分段、列表照留；没有人声是空的", () => {
  const listed =
    "<原文>\n有两件事：\n\n1. 改按钮\n2. 调间距\n</原文>\n<译文>\nTwo things:\n\n1. Fix the button\n2. Adjust the spacing\n</译文>";
  assert.equal(
    translationFromModelOutput(listed, english).text,
    "Two things:\n\n1. Fix the button\n2. Adjust the spacing",
  );
  for (const silent of [NO_SPEECH_MARK, "", null, `<译文>${NO_SPEECH_MARK}</译文>`]) {
    assert.equal(translationFromModelOutput(silent, english).text, "");
  }
});

test("收尾：译成简体中文时夹着的繁体字转成简体；译成繁体、日语的照模型写的", () => {
  const output = "<原文>Let's go</原文><译文>我們走吧</译文>";
  assert.equal(translationFromModelOutput(output, findLanguage("zh-CN")).text, "我们走吧");
  assert.equal(translationFromModelOutput(output, findLanguage("zh-TW")).text, "我們走吧");
  assert.equal(translationFromModelOutput("<译文>國際會議</译文>", findLanguage("ja")).text, "國際會議");
});

test("混合方式：模型没写出原文时拿识别出来的字当原文存", () => {
  const bound = translate.bind({ output_language: "en" });
  assert.deepEqual(bound.polish.finish("Hello", " 你好 "), { text: "Hello", source: "你好" });
  assert.deepEqual(bound.polish.finish("<原文>你好！</原文><译文>Hello!</译文>", "你好"), {
    text: "Hello!",
    source: "你好！",
  });
  assert.deepEqual(bound.polish.finish(NO_SPEECH_MARK, "嗯"), { text: "", source: null });
});

test("语言表：id 不重复，每种都有写进提示词的叫法", () => {
  const ids = LANGUAGES.map(({ id }) => id);
  assert.equal(new Set(ids.map((id) => id.toLowerCase())).size, ids.length);
  for (const language of LANGUAGES) assert.match(language.prompt, /^\S+（[A-Za-z ]+）$/);
});

test("语言表：每种语言在每种界面语言里都有名字", async () => {
  const { createTranslator, LOCALES } = await import("../../../../src/i18n/index.mjs");
  const { languageName } = await import("../../../../src/languages.mjs");
  for (const { id: locale } of LOCALES) {
    const t = createTranslator(locale);
    for (const { id } of LANGUAGES) {
      const name = t.text(languageName(id));
      assert.ok(name && name !== `languages.${id}`, `${locale} 没有 ${id} 的名字`);
    }
  }
});
