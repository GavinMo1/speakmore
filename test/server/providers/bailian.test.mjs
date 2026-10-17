import assert from "node:assert/strict";
import { test } from "node:test";
import { createTranslator } from "../../../src/i18n/index.mjs";
import { classifyError, createClient } from "../../../src/server/providers/bailian.mjs";
import { toModelError } from "../../../src/server/providers/errors.mjs";

const zh = createTranslator("zh-CN");

function fakeFetch(status, body) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { fetch, requests };
}

/** 2026-10-16 实测 qwen3.8-omni-flash 关掉思考后的回话（正文换掉了） */
const REPLY = {
  choices: [{ finish_reason: "stop", index: 0, message: { content: "我现在有几件事要做。", reasoning_content: "" } }],
  model: "qwen3.8-omni-flash",
  usage: {
    completion_tokens: 51,
    completion_tokens_details: { text_tokens: 51 },
    prompt_tokens: 194,
    prompt_tokens_details: { audio_tokens: 163, cached_tokens: 0, text_tokens: 31 },
  },
};

test("原生：录音写成 data URI 交给兼容接口，只要文字、关掉思考；回原文和用量", async () => {
  const { fetch, requests } = fakeFetch(200, REPLY);
  const client = createClient({ apiKey: "sk-ws-test", model: "qwen3.8-omni-flash", fetch });
  const reply = await client.generate({
    audio: Buffer.from("RIFF"),
    mimeType: "audio/wav",
    systemPrompt: "系统",
    reminder: "提醒",
  });
  assert.equal(reply.text, "我现在有几件事要做。");
  assert.equal(reply.problem, null);
  assert.equal(reply.usage.audioTokens, 163);
  assert.equal(reply.usage.inputTokens, 194);
  assert.equal(reply.usage.thinkingTokens, 0);
  assert.ok(reply.usage.costUsd > 0);
  const [{ url, headers, body }] = requests;
  assert.equal(url, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal(headers.Authorization, "Bearer sk-ws-test");
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.modalities, ["text"]);
  assert.equal(body.messages[0].content, "系统");
  const [audio, text] = body.messages[1].content;
  assert.deepEqual(audio.input_audio, {
    data: `data:audio/wav;base64,${Buffer.from("RIFF").toString("base64")}`,
    format: "wav",
  });
  assert.deepEqual(text, { type: "text", text: "提醒" });
});

test("没正常结束的不当成品", async () => {
  const { fetch } = fakeFetch(200, { ...REPLY, choices: [{ finish_reason: "length", message: { content: "半截" } }] });
  const reply = await createClient({ apiKey: "k", model: "m", fetch }).generate({
    audio: Buffer.alloc(4),
    mimeType: "audio/wav",
    systemPrompt: "",
    reminder: "",
  });
  assert.equal(reply.text, null);
  assert.match(zh.text(reply.problem), /没有正常结束/);
});

test("报错：key 不对、没开通、欠费、限流各有各的说法", async () => {
  const cases = [
    [401, { error: { message: "Invalid API-key provided.", code: "invalid_api_key" } }, "key", /无效/],
    [
      400,
      { error: { message: "The product is not activated, please confirm…", code: "invalid_parameter_error" } },
      "other",
      /还没开通/,
    ],
    [
      400,
      { code: "Arrearage", message: "Access denied, please make sure your account is in good standing." },
      "key",
      /额度/,
    ],
    [429, { error: { message: "Requests rate limit exceeded", code: "limit_requests" } }, "unavailable", /暂时用不了/],
  ];
  for (const [status, body, kind, pattern] of cases) {
    const { fetch } = fakeFetch(status, body);
    const error = await createClient({ apiKey: "sk-secret", model: "m", fetch })
      .ping({})
      .catch((caught) => caught);
    const described = toModelError(error, {
      provider: { name: "Bailian" },
      apiKey: "sk-secret",
      classify: classifyError,
    });
    assert.equal(described.kind, kind, JSON.stringify(body));
    assert.match(zh.text(described.problem), pattern);
  }
});
