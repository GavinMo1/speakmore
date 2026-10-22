import assert from "node:assert/strict";
import { test } from "node:test";
import { findLocale } from "../../src/i18n/index.mjs";

// 界面规范的文案词表（docs/desktop-ui-spec.md 第 1 节）：桌面端用书面语、短词，下面这些口语的说法不再用。
// 规矩落在词表里才算数，所以由测试守着：中文词条里出现"不再使用"那一列的词就失败。
// 命令行（cli.*）和后台服务对命令行说的话（control.*）不在这次的范围里（2026-10-16 定的：先管桌面端）。

const BANNED = [
  ["能用", "检测通过 / 可用 / 即可使用"],
  ["用这个", "启用"],
  ["挑模型", "模型库"],
  ["经由", "渠道"],
  ["未实测", "未评测"],
  ["只看能用", "仅显示可用"],
  ["未填", "未配置"],
  ["已填", "已配置"],
  ["解锁", "新增 N 个可用模型"],
  ["切到", "切换至"],
];
// 识别方式和步骤的旧叫法（2026-10-22 改的）：用户看不懂"转写 + 润色""原生"，名字也不许按过程起。这几条命令行里也不许有
const RENAMED = [
  ["原生", "直出"],
  ["转写", "转文字"],
  ["润色", "整理"],
  ["数据隐私", "离线"],
  ["第一跳", "转文字那一步"],
  ["第二跳", "整理那一步"],
  ["环节", "步骤"],
  ["成稿", "出字 / 结果"],
];
/** "已选定"可以，单说"已选"不行 */
const BANNED_PATTERNS = [[/已选(?!定)/, "已选定"]];
const OUT_OF_SCOPE = /^(cli|control)\./;

function strings(node, prefix = "") {
  return Object.entries(node).flatMap(([name, value]) => {
    const key = `${prefix}${name}`;
    if (typeof value === "string") return [[key, value]];
    if (value && typeof value === "object") return strings(value, `${key}.`);
    return [];
  });
}

test("桌面端的中文词条里没有词表里不再使用的说法", () => {
  const offenders = [];
  for (const [key, text] of strings(findLocale("zh-CN").messages)) {
    for (const [word, instead] of RENAMED) if (text.includes(word)) offenders.push(`${key}：「${word}」→ ${instead}`);
    if (OUT_OF_SCOPE.test(key)) continue;
    for (const [word, instead] of BANNED) if (text.includes(word)) offenders.push(`${key}：「${word}」→ ${instead}`);
    for (const [pattern, instead] of BANNED_PATTERNS)
      if (pattern.test(text)) offenders.push(`${key}：${pattern} → ${instead}`);
  }
  assert.deepEqual(offenders, []);
});

test("词表本身查得到东西：拿一句违规的话试一下", () => {
  assert.ok(BANNED.some(([word]) => "这把 key 能用".includes(word)));
  assert.ok(RENAMED.some(([word]) => "转写 + 润色".includes(word)));
  assert.ok(BANNED_PATTERNS.some(([pattern]) => pattern.test("已选")));
  assert.ok(!BANNED_PATTERNS.some(([pattern]) => pattern.test("已选定")));
});
