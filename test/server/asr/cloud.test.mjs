import assert from "node:assert/strict";
import { test } from "node:test";
import { createTranslator } from "../../../src/i18n/index.mjs";
import { createClient } from "../../../src/server/asr/cloud/bailian.mjs";
import { createCloudTranscriber } from "../../../src/server/asr/cloud/transcriber.mjs";
import { CLOUD_TRANSCRIBERS, cloudTranscriberOf } from "../../../src/server/asr/cloud/vendors.mjs";

const zh = createTranslator("zh-CN");
const log = { info() {}, warn() {}, error() {} };

function fakeFetch(status, body) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetch, requests };
}

test("设置里的第一跳：厂商/模型是云端的，只写厂商用默认模型；本机模型的 id 不算", () => {
  assert.deepEqual(cloudTranscriberOf("bailian/qwen-audio-3.1-asr-flash"), {
    vendor: "bailian",
    model: "qwen-audio-3.1-asr-flash",
  });
  assert.deepEqual(cloudTranscriberOf("Bailian"), { vendor: "bailian", model: "qwen3-asr-flash" });
  assert.equal(cloudTranscriberOf("qwen3-asr-0.6b-q8"), null);
  assert.equal(cloudTranscriberOf("nobody/x"), null);
});

test("清单：每个模型说清走哪套接口，默认模型在清单里", () => {
  for (const vendor of CLOUD_TRANSCRIBERS) {
    assert.ok(vendor.models.some(({ id }) => id === vendor.defaultModel));
    for (const model of vendor.models) assert.ok(["chat", "dashscope"].includes(model.wire), model.id);
  }
});

test("qwen3-asr-flash 走兼容接口：原文在 message.content，按时长算钱", async () => {
  const { fetch, requests } = fakeFetch(200, {
    choices: [{ finish_reason: "stop", message: { content: "我现在有几件事要做" } }],
    model: "qwen3-asr-flash",
    usage: { completion_tokens: 60, prompt_tokens: 585, prompt_tokens_details: { audio_tokens: 585 }, seconds: 23 },
  });
  const reply = await createClient({ apiKey: "k", model: "qwen3-asr-flash", fetch }).transcribe({
    wav: Buffer.from("RIFF"),
  });
  assert.equal(reply.text, "我现在有几件事要做");
  assert.equal(reply.usage.audioTokens, 585);
  assert.ok(reply.usage.costUsd > 0);
  assert.equal(requests[0].url, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.match(requests[0].body.messages[0].content[0].input_audio.data, /^data:audio\/wav;base64,/);
});

test("qwen-audio、fun-asr 走百炼自己的接口：写明格式和采样率、关掉流式，原文在 output.text", async () => {
  const { fetch, requests } = fakeFetch(200, {
    output: { text: "整段原文", output: { text: "整段原文", sentence: { text: "整段原文" } } },
    usage: { duration: 55, input_tokens: 740, output_tokens: 94 },
  });
  const reply = await createClient({ apiKey: "k", model: "qwen-audio-3.1-asr-flash", fetch }).transcribe({
    wav: Buffer.from("RIFF"),
  });
  assert.equal(reply.text, "整段原文");
  assert.ok(reply.usage.costUsd > 0);
  const [{ url, headers, body }] = requests;
  assert.equal(url, "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
  assert.equal(headers["X-DashScope-SSE"], "disable");
  assert.deepEqual(body.parameters, { format: "wav", sample_rate: "16000" });
});

test("转写器：录音编成 wav 交出去、记一笔账；报错分好类往上交", async () => {
  const calls = [];
  const ok = fakeFetch(200, { output: { text: "  好的  " }, usage: { duration: 1 } });
  const transcriber = await createCloudTranscriber({
    choice: { vendor: "bailian", model: "fun-asr-flash-2026-06-15" },
    apiKey: "k",
    log,
    onCall: (call) => calls.push(call),
    fetch: ok.fetch,
  });
  assert.deepEqual(await transcriber.transcribe(new Float32Array(16_000), { audioId: "a1" }), { text: "好的" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "bailian");
  assert.equal(calls[0].audioId, "a1");
  assert.equal(calls[0].purpose, "dictation");

  const bad = fakeFetch(401, { error: { message: "Invalid API-key provided.", code: "invalid_api_key" } });
  const failing = await createCloudTranscriber({
    choice: { vendor: "bailian", model: "qwen3-asr-flash" },
    apiKey: "k",
    log,
    fetch: bad.fetch,
  });
  const error = await failing.warmUp().catch((caught) => caught);
  assert.equal(error.kind, "key");
  assert.match(zh.text(error.problem), /无效/);
});
