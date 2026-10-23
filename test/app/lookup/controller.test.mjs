import assert from "node:assert/strict";
import { test } from "node:test";
import { createLookup, MAX_LOOKUP_CHARS } from "../../../src/app/lookup/controller.mjs";
import { LocalizedError, msg } from "../../../src/i18n/index.mjs";
import { LANGUAGES } from "../../../src/languages.mjs";
import { ModelError } from "../../../src/server/providers/errors.mjs";

const quiet = { info() {}, warn() {}, error() {} };
const RECT = { x: 240, y: 352, width: 560, height: 56 };

/** 等排着的 Promise 都跑完 */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * 假的周边：选区、翻译、卡片、剪贴板、历史、提醒。translate 默认回"译：原文"；
 * 给 replies 的话按顺序回（Error 就抛，"wait" 就一直等到 release）
 */
function setup({
  picked = { text: "hello", rect: RECT, via: "ax", reason: null, ms: 5 },
  busy = false,
  selection = async () => picked,
  record,
  log = quiet,
} = {}) {
  const calls = { card: [], translate: [], copied: [], notices: [], history: [], keys: 0 };
  const replies = [];
  let ids = 0;
  const lookup = createLookup({
    selection,
    engine: {
      current: () => ({ to: "zh-CN" }),
      async translate(text, { language, lookupId, signal }) {
        calls.translate.push({ text, language, lookupId });
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        if (reply?.wait) {
          await reply.wait;
          if (signal.aborted) throw new DOMException("aborted", "AbortError");
        }
        return { text: reply?.text ?? `译：${text}`, language: reply?.language ?? language };
      },
    },
    card: {
      show: (view, anchor) => calls.card.push({ show: view, anchor }),
      update: (view) => calls.card.push({ update: view }),
      hide: () => calls.card.push({ hide: true }),
    },
    copy: (text) => calls.copied.push(text),
    notify: (message) => calls.notices.push(message),
    record: record ?? ((entry) => calls.history.push(entry)),
    busy: typeof busy === "function" ? busy : () => busy,
    openKeys: () => calls.keys++,
    newId: () => `id-${++ids}`,
    now: () => new Date("2026-10-22T12:00:00.000Z"),
    log,
  });
  const last = () => {
    const shown = calls.card.filter((call) => call.show || call.update).at(-1);
    return shown?.show ?? shown?.update;
  };
  return { lookup, calls, replies, last };
}

test("按下：取选区，在选区下方弹卡片（先是翻译中），译成设置里的语言，译好换上译文、记进历史", async () => {
  const { lookup, calls, last } = setup();
  await lookup.press();
  const [first] = calls.card;
  assert.deepEqual(first.anchor, { rect: RECT });
  assert.equal(first.show.phase, "loading");
  assert.equal(first.show.language, "zh-CN");
  assert.deepEqual(
    first.show.languages,
    LANGUAGES.map(({ id }) => id),
  );
  await settle();
  assert.deepEqual(calls.translate, [{ text: "hello", language: "zh-CN", lookupId: "id-1" }]);
  assert.deepEqual(
    { phase: last().phase, text: last().text, pinned: last().pinned },
    { phase: "done", text: "译：hello", pinned: false },
  );
  assert.deepEqual(calls.history, [
    {
      id: "id-1",
      kind: "lookup",
      status: "completed",
      refinedText: "译：hello",
      sourceText: "hello",
      outputLanguage: "zh-CN",
      error: null,
      duration: 0,
      audioFile: null,
      createdAt: "2026-10-22T12:00:00.000Z",
    },
  ]);
  assert.equal(lookup.open, true);
});

test("原文已经是目标语言、改译成了另一种：卡片上写实际译成的那种，历史里也记它", async () => {
  const { lookup, calls, replies, last } = setup();
  replies.push({ text: "Our legal team has reviewed it.", language: "en" });
  await lookup.press();
  await settle();
  assert.equal(last().language, "en");
  assert.equal(calls.history[0].outputLanguage, "en");
});

test("选中的字统一成 \\n 换行（Windows 记事本里是 \\r），首尾空白去掉", async () => {
  const { lookup, calls } = setup({ picked: { text: "  a\r\nb\rc \n", rect: null, reason: null } });
  await lookup.press();
  await settle();
  assert.equal(calls.translate[0].text, "a\nb\nc");
  assert.deepEqual(calls.card[0].anchor, { rect: null });
});

test("没取到字：不弹卡片，在悬浮条上说为什么", async () => {
  const cases = [
    ["none", "lookup.noSelection"],
    ["not_trusted", "lookup.noAccessibility"],
    ["elevated", "lookup.elevated"],
    ["timeout", "lookup.selectionFailed"],
    ["failed", "lookup.selectionFailed"],
    ["gone", "lookup.selectionFailed"],
  ];
  for (const [reason, key] of cases) {
    const { lookup, calls } = setup({ picked: { text: "", rect: null, reason } });
    await lookup.press();
    assert.deepEqual(calls.card, [], reason);
    assert.deepEqual(calls.notices, [msg(key)], reason);
  }
  // 只有空白也算没选中
  const blank = setup({ picked: { text: " \r\n ", rect: RECT, reason: null } });
  await blank.lookup.press();
  assert.deepEqual(blank.calls.notices, [msg("lookup.noSelection")]);
});

test("选得太长：不弹卡片，说一次最多多少字", async () => {
  const { lookup, calls } = setup({ picked: { text: "x".repeat(MAX_LOOKUP_CHARS + 1), rect: null } });
  await lookup.press();
  assert.deepEqual(calls.card, []);
  assert.deepEqual(calls.notices, [msg("lookup.tooLong", { max: MAX_LOOKUP_CHARS })]);
});

test("正在说话（悬浮条截着键）：这一下不理", async () => {
  const { lookup, calls } = setup({ busy: true });
  await lookup.press();
  assert.deepEqual(calls.card, []);
  assert.deepEqual(calls.translate, []);
});

test("等选区的时候开始说话了：选区回来也不弹卡片，不抢悬浮条的截取", async () => {
  let talking = false;
  let answer;
  const { lookup, calls } = setup({
    busy: () => talking,
    selection: () => new Promise((resolve) => (answer = resolve)),
  });
  const pressed = lookup.press();
  talking = true;
  answer({ text: "hello", rect: RECT, via: "copy", reason: null, ms: 400 });
  await pressed;
  assert.deepEqual(calls.card, []);
  assert.deepEqual(calls.translate, []);
  assert.equal(lookup.open, false);
});

test("记历史出错：卡片留在译文上，不改成出错、不让重试，只记一条错误日志", async () => {
  const errors = [];
  const { lookup, last } = setup({
    record: () => {
      throw new Error("SQLITE_BUSY: database is locked");
    },
    log: { ...quiet, error: (event, fields) => errors.push({ event, ...fields }) },
  });
  await lookup.press();
  await settle();
  assert.deepEqual(
    { phase: last().phase, text: last().text, action: last().action },
    {
      phase: "done",
      text: "译：hello",
      action: null,
    },
  );
  assert.deepEqual(
    errors.map(({ event, lookup_id }) => [event, lookup_id]),
    [["lookup_record_failed", "id-1"]],
  );
});

test("缺 key：卡片上一句原因、一个配置密钥；点了收起卡片、打开引擎页", async () => {
  const { lookup, calls, replies, last } = setup();
  const missing = Object.assign(new LocalizedError(msg("lookup.noKey", { provider: "Kimi" })), { kind: "missing" });
  replies.push(missing);
  await lookup.press();
  await settle();
  assert.deepEqual(
    { phase: last().phase, problem: last().problem, action: last().action },
    { phase: "error", problem: msg("lookup.noKey", { provider: "Kimi" }), action: "keys" },
  );
  assert.deepEqual(calls.history, []);
  lookup.act("keys");
  assert.deepEqual(calls.card.at(-1), { hide: true });
  assert.equal(calls.keys, 1);
  assert.equal(lookup.open, false);
});

test("模型那边出错：给重试；重试换一个 id 再译，成了照常记历史。key 不对的也给配置密钥", async () => {
  const { lookup, calls, replies, last } = setup();
  replies.push(new ModelError({ kind: "unavailable", problem: "连不上 DeepSeek", detail: "fetch failed" }));
  await lookup.press();
  await settle();
  assert.deepEqual([last().phase, last().problem, last().action], ["error", "连不上 DeepSeek", "retry"]);
  lookup.act("retry");
  assert.equal(last().phase, "loading");
  await settle();
  assert.deepEqual(
    calls.translate.map(({ lookupId }) => lookupId),
    ["id-1", "id-2"],
  );
  assert.equal(last().phase, "done");
  assert.equal(calls.history[0].id, "id-2");

  const rejected = setup();
  rejected.replies.push(new ModelError({ kind: "key", problem: "这把 key 无效", detail: "401" }));
  await rejected.lookup.press();
  await settle();
  assert.equal(rejected.last().action, "keys");
});

test("卡片上换语言：只管这一次，按新的语言再译、另记一条；不认识的、和现在一样的不理", async () => {
  const { lookup, calls, last } = setup();
  await lookup.press();
  await settle();
  lookup.act("pick:ja");
  assert.equal(last().language, "ja");
  await settle();
  assert.deepEqual(calls.translate.at(-1), { text: "hello", language: "ja", lookupId: "id-2" });
  assert.deepEqual(
    calls.history.map(({ outputLanguage }) => outputLanguage),
    ["zh-CN", "ja"],
  );
  lookup.act("pick:ja");
  lookup.act("pick:xx");
  await settle();
  assert.equal(calls.translate.length, 2);
});

test("复制：译文进剪贴板，卡片留着；没译好时不理。卡片上没有替换（10-23 砍掉了）", async () => {
  const { lookup, calls, last } = setup();
  await lookup.press();
  await settle();
  lookup.act("copy");
  assert.deepEqual(calls.copied, ["译：hello"]);
  assert.equal(lookup.open, true);
  assert.equal("editable" in last(), false);
  lookup.act("replace");
  assert.equal(lookup.open, true);
  const pending = setup();
  pending.replies.push({ wait: new Promise(() => {}) });
  await pending.lookup.press();
  pending.lookup.act("copy");
  assert.deepEqual(pending.calls.copied, []);
});

test("点别处收起；固定了的不收，取消固定后再点别处才收", async () => {
  const { lookup } = setup();
  await lookup.press();
  await settle();
  lookup.act("pin");
  lookup.outside();
  assert.equal(lookup.open, true);
  lookup.act("pin");
  lookup.outside();
  assert.equal(lookup.open, false);
});

test("esc、关闭按钮收起；还在译的那一次作废，回来的结果不画、不记", async () => {
  const { lookup, calls, replies } = setup();
  let release;
  replies.push({ wait: new Promise((resolve) => (release = resolve)) });
  await lookup.press();
  lookup.cancel();
  assert.equal(lookup.open, false);
  release();
  await settle();
  assert.deepEqual(calls.history, []);
  assert.deepEqual(calls.card.at(-1), { hide: true });

  const closed = setup();
  await closed.lookup.press();
  await settle();
  closed.lookup.act("close");
  assert.equal(closed.lookup.open, false);
});

test("卡片开着又按了一次：换成新的这一次", async () => {
  const { lookup, calls, replies } = setup();
  replies.push({ wait: new Promise(() => {}) });
  await lookup.press();
  await lookup.press();
  await settle();
  assert.deepEqual(
    calls.card.filter((call) => call.show || call.hide).map((call) => (call.show ? "show" : "hide")),
    ["show", "hide", "show"],
  );
  assert.equal(calls.history.length, 1);
  assert.equal(calls.history[0].id, "id-2");
});

test("没开着时的点击、esc、点别处：什么都不做", () => {
  const { lookup, calls } = setup();
  lookup.act("copy");
  lookup.cancel();
  lookup.outside();
  assert.deepEqual(calls.card, []);
});
