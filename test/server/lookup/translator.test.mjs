import assert from "node:assert/strict";
import { test } from "node:test";
import { findLanguage } from "../../../src/languages.mjs";
import { translationOf } from "../../../src/server/lookup/output.mjs";
import { fallbackOf, lookupInput, lookupPrompt } from "../../../src/server/lookup/prompt.mjs";
import { createTranslator } from "../../../src/server/lookup/translator.mjs";
import { ModelError } from "../../../src/server/providers/errors.mjs";

const quiet = { info() {}, warn() {}, error() {} };
const zhCN = findLanguage("zh-CN");
const en = findLanguage("en");
const ja = findLanguage("ja");
const USAGE = {
  model: "deepseek-flash",
  inputTokens: 300,
  audioTokens: 0,
  cachedTokens: 0,
  outputTokens: 20,
  thinkingTokens: 0,
  costUsd: 0.00005,
};

/** 假的协议客户端：记下收到的请求，按顺序回给定的回话（是 Error 就抛） */
function fakeClient(...replies) {
  const requests = [];
  const next = () => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return {
    requests,
    client: {
      async ping(request) {
        requests.push({ ping: request });
        return next() ?? { usage: USAGE };
      },
      async complete(request) {
        requests.push(request);
        return next();
      },
    },
  };
}

const translatorWith = (client, extra = {}) =>
  createTranslator({ endpoint: { id: "deepseek", name: "DeepSeek" }, client, log: quiet, ...extra });

test("提示词：最上面一行是目标语言；选中的字放在标签里，标签外再点名译成哪种。已是目标语言时改译成哪种：英语改成简体中文，别的改成英语", () => {
  assert.equal(lookupPrompt(zhCN).split("\n")[0], "目标语言：简体中文（Simplified Chinese）");
  assert.equal(fallbackOf(zhCN), en);
  assert.equal(fallbackOf(ja), en);
  assert.equal(fallbackOf(en), zhCN);
  const input = lookupInput("Hello\nworld", ja);
  assert.ok(input.startsWith("<选中文字>\nHello\nworld\n</选中文字>\n"));
  assert.match(input, /译成日语（Japanese），只输出译文/);
});

test("原文已经是目标语言（认得出的）：不问模型就改译成另一种，交回实际译成的语言", async () => {
  const { client, requests } = fakeClient({ text: "Our legal team has reviewed it.", problem: null, usage: USAGE });
  const result = await translatorWith(client).translate("我们这边法务已经看过了。", { language: zhCN, lookupId: "l" });
  assert.deepEqual(result, { text: "Our legal team has reviewed it.", language: "en" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].system, lookupPrompt(en));
  assert.equal(requests[0].user, lookupInput("我们这边法务已经看过了。", en));
});

test("认不出、模型照抄回来（拉丁字母的语言）：再按另一种译一遍，两笔都记在这一次上", async () => {
  const calls = [];
  const { client, requests } = fakeClient(
    { text: "pipeline", problem: null, usage: USAGE },
    { text: "流水线；管道", problem: null, usage: USAGE },
  );
  const result = await translatorWith(client, { onCall: (call) => calls.push(call) }).translate("pipeline", {
    language: en,
    lookupId: "l-9",
  });
  assert.deepEqual(result, { text: "流水线；管道", language: "zh-CN" });
  assert.deepEqual(
    requests.map(({ user }) => user),
    [lookupInput("pipeline", en), lookupInput("pipeline", zhCN)],
  );
  assert.deepEqual(
    calls.map(({ purpose, audioId }) => [purpose, audioId]),
    [
      ["lookup", "l-9"],
      ["lookup", "l-9"],
    ],
  );
});

test("收尾：去掉首尾空白和模型多写的标签；译成简体中文时繁体字转简体，别的语言照写的", () => {
  assert.equal(translationOf("  模型把音频留在你的设备上。\n", zhCN), "模型把音频留在你的设备上。");
  assert.equal(translationOf("<译文>\n這個模型\n</译文>", zhCN), "这个模型");
  assert.equal(translationOf("這個 model", findLanguage("zh-TW")), "這個 model");
  assert.equal(translationOf("<选中文字>Hi</选中文字>", en), "Hi");
  assert.equal(translationOf(null, en), "");
});

test("翻译：系统提示词按这一次的语言现拼，选中的字放进用户消息；按划词记账，带上这一次的 id", async () => {
  const calls = [];
  const { client, requests } = fakeClient({ text: "模型把音频留在你的设备上。", problem: null, usage: USAGE });
  const translator = translatorWith(client, { onCall: (call) => calls.push(call) });
  const result = await translator.translate("The model keeps the audio on your device.", {
    language: zhCN,
    lookupId: "l-1",
  });
  assert.deepEqual(result, { text: "模型把音频留在你的设备上。", language: "zh-CN" });
  assert.equal(requests[0].system, lookupPrompt(zhCN));
  assert.equal(requests[0].user, lookupInput("The model keeps the audio on your device.", zhCN));
  assert.ok(requests[0].signal instanceof AbortSignal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].purpose, "lookup");
  assert.equal(calls[0].audioId, "l-1");
  assert.equal(calls[0].provider, "deepseek");
});

test("选中的是空白：不调模型", async () => {
  const { client, requests } = fakeClient();
  assert.deepEqual(await translatorWith(client).translate(" \n ", { language: zhCN, lookupId: "l-2" }), {
    text: "",
    language: "zh-CN",
  });
  assert.equal(requests.length, 0);
});

test("出错：模型回的问题、请求失败都换成分好类的 ModelError，key 从原话里抹掉", async () => {
  const refused = fakeClient({ text: null, problem: { key: "chat.truncated" }, usage: USAGE });
  await assert.rejects(
    translatorWith(refused.client).translate("x", { language: zhCN, lookupId: "l-3" }),
    (error) => error instanceof ModelError,
  );
  const failing = fakeClient(Object.assign(new Error("401 sk-secret123456"), { status: 401 }));
  await assert.rejects(
    translatorWith(failing.client, { apiKey: "sk-secret123456" }).translate("x", { language: zhCN, lookupId: "l-4" }),
    (error) => error instanceof ModelError && !String(error.detail).includes("sk-secret123456"),
  );
});

test("检查：发一个最小的请求，按检查记账", async () => {
  const calls = [];
  const { client, requests } = fakeClient();
  await translatorWith(client, { onCall: (call) => calls.push(call) }).warmUp();
  assert.ok(requests[0].ping);
  assert.equal(calls[0].purpose, "check");
});
