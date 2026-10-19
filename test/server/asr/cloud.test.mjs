import assert from "node:assert/strict";
import { test } from "node:test";
import { createTranslator } from "../../../src/i18n/index.mjs";
import { createClient } from "../../../src/server/asr/cloud/bailian.mjs";
import * as minimax from "../../../src/server/asr/cloud/minimax.mjs";
import { createCloudTranscriber } from "../../../src/server/asr/cloud/transcriber.mjs";
import { CLOUD_TRANSCRIBERS, cloudModelOf, cloudTranscriberOf } from "../../../src/server/asr/cloud/vendors.mjs";
import * as zhipu from "../../../src/server/asr/cloud/zhipu.mjs";
import { encodeWav } from "../../../src/server/audio/pcm.mjs";
import { toModelError } from "../../../src/server/providers/errors.mjs";
import { fitTerms, VOCABULARY_KINDS } from "../../../src/vocabulary/support.mjs";

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

test("清单：默认模型在清单里，一段有上限的写成正的秒数；百炼的每个模型说清走哪套接口", () => {
  for (const vendor of CLOUD_TRANSCRIBERS) {
    assert.ok(
      vendor.models.some(({ id }) => id === vendor.defaultModel),
      vendor.id,
    );
    for (const model of vendor.models) {
      if (model.maxSeconds !== undefined) assert.ok(model.maxSeconds > 0, model.id);
    }
  }
  const bailian = CLOUD_TRANSCRIBERS.find(({ id }) => id === "bailian");
  for (const model of bailian.models) assert.ok(["chat", "dashscope"].includes(model.wire), model.id);
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
  assert.deepEqual(await transcriber.transcribe(new Float32Array(16_000).fill(0.1), { audioId: "a1" }), {
    text: "好的",
  });
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

/**
 * 收 multipart 上传的假接口：记下每次交了哪些字段、文件多大，按 reply(第几次) 回话。
 * delay(第几次) 让先发的晚回，查拼起来的顺序是按段、不是按谁先回
 */
function fakeUpload(status, reply, delay = () => 0) {
  const requests = [];
  const fetch = async (url, init) => {
    const index = requests.length;
    const file = init.body.get("file");
    const entries = [...init.body.entries()].filter(([name]) => name !== "file");
    const fields = Object.fromEntries(entries);
    requests.push({
      url,
      headers: init.headers,
      fields,
      entries,
      file: { name: file.name, type: file.type, size: file.size },
    });
    await new Promise((resolve) => setTimeout(resolve, delay(index)));
    return new Response(JSON.stringify(typeof reply === "function" ? reply(index) : reply), { status });
  };
  return { fetch, requests };
}

const wavOf = (seconds) => encodeWav(new Float32Array(seconds * 16_000).fill(0.1), 16_000);

/** 让适配器真去请求一次，拿到它抛的错，再按 errors.mjs 的规矩分类 */
async function uploadFailure(adapter, model, status, body) {
  const { fetch } = fakeUpload(status, body);
  const error = await adapter
    .createClient({ apiKey: "sk-secret", model, fetch })
    .transcribe({ wav: wavOf(1) })
    .catch((caught) => caught);
  const described = toModelError(error, {
    provider: { name: "x" },
    apiKey: "sk-secret",
    classify: adapter.classifyError,
  });
  return { kind: described.kind, problem: zh.text(described.problem) };
}

test("智谱 GLM-ASR：照官方文档 multipart 交 model、stream=false 和 wav，原文在 text，按录音时长算钱", async () => {
  const { fetch, requests } = fakeUpload(200, {
    id: "t1",
    created: 1760000000,
    request_id: "r1",
    model: "glm-asr-2512",
    text: "我现在有几件事要做",
  });
  const reply = await zhipu.createClient({ apiKey: "k", model: "glm-asr-2512", fetch }).transcribe({ wav: wavOf(10) });
  assert.equal(reply.text, "我现在有几件事要做");
  const { CNY_PER_USD } = await import("../../../src/server/currency.mjs");
  assert.ok(Math.abs(reply.usage.costUsd - (10 * 0.0002) / CNY_PER_USD) < 1e-12);
  const [{ url, headers, fields, file }] = requests;
  assert.equal(url, "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions");
  assert.equal(headers.Authorization, "Bearer k");
  assert.deepEqual(fields, { model: "glm-asr-2512", stream: "false" });
  assert.deepEqual({ name: file.name, type: file.type }, { name: "audio.wav", type: "audio/wav" });
});

test("智谱 GLM-ASR：报错按智谱的业务码细分（欠费是 429 加 1113），别的按状态码；回话里没有原文就照实报错", async () => {
  const said = (code, message) => ({ error: { code, message } });
  assert.deepEqual(await uploadFailure(zhipu, "glm-asr-2512", 401, said("1000", "身份验证失败")), {
    kind: "key",
    problem: "这把 key 无效，检查有没有复制完整",
  });
  const arrears = await uploadFailure(zhipu, "glm-asr-2512", 429, said("1113", "您的账户已欠费，请充值后重试"));
  assert.equal(arrears.kind, "key");
  assert.match(arrears.problem, /额度/);
  const busy = await uploadFailure(zhipu, "glm-asr-2512", 429, said("1305", "该模型当前访问量过大，请您稍后再试"));
  assert.equal(busy.kind, "unavailable");
  const missing = await uploadFailure(zhipu, "glm-asr-9", 400, said("1211", "模型不存在，请检查模型代码"));
  assert.match(missing.problem, /没有这个模型/);
  const empty = await uploadFailure(zhipu, "glm-asr-2512", 200, { id: "t1" });
  assert.equal(empty.kind, "other");
  assert.match(empty.problem, /text/);
});

test("转写器：清单里写了一段最多几秒的，长录音切开、各段一起发，文字按段的顺序接起来，每段记一笔账", async () => {
  // 65 秒，一段最多 29 秒：切成三段。第一段最晚回
  const { fetch, requests } = fakeUpload(
    200,
    (index) => ({ text: `第${index + 1}段` }),
    (index) => (index === 0 ? 30 : 0),
  );
  const calls = [];
  const transcriber = await createCloudTranscriber({
    choice: { vendor: "zhipu", model: "glm-asr-2512" },
    apiKey: "k",
    log,
    onCall: (call) => calls.push(call),
    fetch,
  });
  const samples = new Float32Array(65 * 16_000).fill(0.1);
  assert.deepEqual(await transcriber.transcribe(samples, { audioId: "a1" }), { text: "第1段第2段第3段" });
  assert.equal(requests.length, 3);
  const seconds = requests.map(({ file }) => (file.size - 44) / 2 / 16_000);
  for (const each of seconds) assert.ok(each <= 29, String(each));
  assert.equal(
    seconds.reduce((sum, each) => sum + each, 0),
    65,
  );
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ provider, audioId }) => provider === "zhipu" && audioId === "a1"));
});

test("MiniMax ASR：照官方文档 multipart 交 model 和 wav，一次回整段；按回话里的时长算钱", async () => {
  const { fetch, requests } = fakeUpload(200, {
    text: "实际上还是商家赚了",
    duration: 26.325,
    trace_id: "021785229015510a2c883cf675b9804d",
  });
  const reply = await minimax.createClient({ apiKey: "k", model: "asr-1.0", fetch }).transcribe({ wav: wavOf(1) });
  assert.equal(reply.text, "实际上还是商家赚了");
  const { CNY_PER_USD } = await import("../../../src/server/currency.mjs");
  assert.ok(Math.abs(reply.usage.costUsd - (26.325 * 2.5) / 3_600 / CNY_PER_USD) < 1e-12);
  const [{ url, headers, fields, file }] = requests;
  assert.equal(url, "https://api.minimax.cn/v1/speech_to_text");
  assert.equal(headers.Authorization, "Bearer k");
  // 不开 stream、不指定语种：一次回整段，中英混说自动认
  assert.deepEqual(fields, { model: "asr-1.0" });
  assert.equal(file.type, "audio/wav");
});

test("MiniMax ASR：报错按状态码认（文档说状态码就是错误码），402 是余额不足", async () => {
  const said = (type, message) => ({ type: "error", error: { type, message }, request_id: "r1" });
  assert.equal((await uploadFailure(minimax, "asr-1.0", 401, said("authorized_error", "invalid api key"))).kind, "key");
  const broke = await uploadFailure(
    minimax,
    "asr-1.0",
    402,
    said("insufficient_balance_error", "insufficient balance (1008)"),
  );
  assert.equal(broke.kind, "key");
  assert.match(broke.problem, /额度/);
  const limited = await uploadFailure(minimax, "asr-1.0", 429, said("rate_limit_error", "rate limit"));
  assert.equal(limited.kind, "unavailable");
  const sensitive = await uploadFailure(minimax, "asr-1.0", 422, said("unprocessable_entity_error", "sensitive"));
  assert.match(sensitive.problem, /拒绝了请求：sensitive/);
});

test("转写器：全是静音的段不发（同本机模型），整段静音、空录音一个请求都不发、不记账", async () => {
  const { fetch, requests } = fakeUpload(200, (index) => ({ text: `第${index + 1}段` }));
  const calls = [];
  const transcriber = await createCloudTranscriber({
    choice: { vendor: "zhipu", model: "glm-asr-2512" },
    apiKey: "k",
    log,
    onCall: (call) => calls.push(call),
    fetch,
  });
  assert.deepEqual(await transcriber.transcribe(new Float32Array(8 * 16_000)), { text: "" });
  assert.deepEqual(await transcriber.transcribe(new Float32Array(0)), { text: "" });
  assert.equal(requests.length, 0);
  assert.equal(calls.length, 0);
  // 35 秒说话加 30 秒静音：切成三段，最后那段全是静音，不发
  const samples = new Float32Array(65 * 16_000);
  samples.fill(0.1, 0, 35 * 16_000);
  await transcriber.transcribe(samples);
  assert.equal(requests.length, 2);
});

test("百炼：回了 2xx 却找不到原文，说明接口和这里对不上，照实报错，不当成没听到声音", async () => {
  for (const [model, body] of [
    ["qwen3-asr-flash", { choices: [{ message: {} }], usage: {} }],
    ["fun-asr-flash-2026-06-15", { output: { choices: [] }, usage: { duration: 1 } }],
  ]) {
    const { fetch } = fakeFetch(200, body);
    await assert.rejects(createClient({ apiKey: "k", model, fetch }).transcribe({ wav: Buffer.from("RIFF") }), /原文/);
  }
});

// ---------- 用户词典：每个型号收不收、怎么收写在清单里，放进请求的哪里由各家的适配器管 ----------

const bailianModel = (id) =>
  cloudModelOf(
    CLOUD_TRANSCRIBERS.find((vendor) => vendor.id === "bailian"),
    id,
  );

test("词典：清单里每个型号写明收法（不收的不写），2026-10-19 拿真 key 逐个试过", () => {
  const kinds = Object.fromEntries(
    CLOUD_TRANSCRIBERS.flatMap((vendor) =>
      vendor.models.map((model) => [`${vendor.id}/${model.id}`, model.vocabulary?.kind ?? null]),
    ),
  );
  assert.deepEqual(kinds, {
    "bailian/qwen3-asr-flash": "context",
    "bailian/qwen-audio-3.1-asr-flash": "hotwords",
    "bailian/qwen-audio-3.0-asr-flash": "hotwords",
    // 收上下文，但会把它原样写进成品：不送（2026-10-19 作者定的）
    "bailian/fun-asr-flash-2026-06-15": null,
    "zhipu/glm-asr-2512": "hotwords",
    "minimax/asr-1.0": null,
  });
  for (const kind of Object.values(kinds)) assert.ok(kind === null || VOCABULARY_KINDS.includes(kind));
});

test("词典：百炼的热词照它的规矩挑（含中文的不超过 15 个字，纯英文不超过 7 个词）", () => {
  const { vocabulary } = bailianModel("qwen-audio-3.1-asr-flash");
  const kept = (term) => fitTerms([term], vocabulary).length === 1;
  assert.equal(kept("喜马拉雅式"), true);
  assert.equal(kept("一二三四五六七八九十一二三四五"), true);
  assert.equal(kept("一二三四五六七八九十一二三四五六"), false);
  assert.equal(kept("AE Sparky Brainstorm"), true);
  assert.equal(kept("one two three four five six seven eight"), false);
});

test("词典：qwen3-asr-flash 放在最前面的 system 消息里（content 写成数组，写成字符串回 400）；没有词就不加这条", async () => {
  const reply = { choices: [{ message: { content: "好" } }], usage: { seconds: 1 } };
  const { fetch, requests } = fakeFetch(200, reply);
  const client = createClient({ apiKey: "k", model: "qwen3-asr-flash", fetch });
  await client.transcribe({ wav: Buffer.from("RIFF"), vocabulary: ["Runzo", "埋点"] });
  const [system, audio] = requests[0].body.messages;
  assert.deepEqual(system, { role: "system", content: [{ type: "text", text: "Runzo，埋点" }] });
  assert.equal(audio.content[0].type, "input_audio");
  await client.transcribe({ wav: Buffer.from("RIFF"), vocabulary: [] });
  assert.equal(requests[1].body.messages.length, 1);
});

test("词典：qwen-audio 交热词（parameters.vocabulary，权重照文档建议的 4）；fun-asr 不送，请求里只有录音", async () => {
  const reply = { output: { text: "好" }, usage: { duration: 1 } };
  const audio = fakeFetch(200, reply);
  await createClient({ apiKey: "k", model: "qwen-audio-3.1-asr-flash", fetch: audio.fetch }).transcribe({
    wav: Buffer.from("RIFF"),
    vocabulary: ["Runzo", "埋点"],
  });
  assert.deepEqual(audio.requests[0].body.parameters, {
    format: "wav",
    sample_rate: "16000",
    vocabulary: { Runzo: 4, 埋点: 4 },
  });
  assert.equal(audio.requests[0].body.input.messages.length, 1);

  const fun = fakeFetch(200, reply);
  await createClient({ apiKey: "k", model: "fun-asr-flash-2026-06-15", fetch: fun.fetch }).transcribe({
    wav: Buffer.from("RIFF"),
    vocabulary: ["Runzo", "埋点"],
  });
  const [recording, ...rest] = fun.requests[0].body.input.messages;
  assert.equal(recording.content[0].type, "input_audio");
  assert.deepEqual(rest, []);
  assert.deepEqual(fun.requests[0].body.parameters, { format: "wav", sample_rate: "16000" });
});

test("词典：智谱每个热词一个 hotwords 字段（词里带逗号也不会被拆开）", async () => {
  const { fetch, requests } = fakeUpload(200, { text: "好" });
  await zhipu
    .createClient({ apiKey: "k", model: "glm-asr-2512", fetch })
    .transcribe({ wav: wavOf(1), vocabulary: ["Runzo", "Hello, World"] });
  assert.deepEqual(
    requests[0].entries.filter(([name]) => name === "hotwords").map(([, value]) => value),
    ["Runzo", "Hello, World"],
  );
});

test("词典：转写器按清单里这个型号的上限挑好词再交给适配器；不收的（MiniMax）、清单外的型号一个都不交", async () => {
  const many = Array.from({ length: 150 }, (_, i) => `t${i}`);
  const zhipuUpload = fakeUpload(200, { text: "好" });
  const zhipuTranscriber = await createCloudTranscriber({
    choice: { vendor: "zhipu", model: "glm-asr-2512" },
    apiKey: "k",
    log,
    fetch: zhipuUpload.fetch,
  });
  await zhipuTranscriber.transcribe(new Float32Array(16_000).fill(0.1), { vocabulary: many });
  const sent = zhipuUpload.requests[0].entries.filter(([name]) => name === "hotwords").map(([, value]) => value);
  assert.deepEqual(sent, many.slice(0, 100));

  const minimaxUpload = fakeUpload(200, { text: "好", duration: 1 });
  const minimaxTranscriber = await createCloudTranscriber({
    choice: { vendor: "minimax", model: "asr-1.0" },
    apiKey: "k",
    log,
    fetch: minimaxUpload.fetch,
  });
  await minimaxTranscriber.transcribe(new Float32Array(16_000).fill(0.1), { vocabulary: many });
  assert.deepEqual(minimaxUpload.requests[0].fields, { model: "asr-1.0" });

  const unknown = fakeFetch(200, { choices: [{ message: { content: "好" } }], usage: { seconds: 1 } });
  const unlisted = await createCloudTranscriber({
    choice: { vendor: "bailian", model: "qwen3-asr-flash-2099" },
    apiKey: "k",
    log,
    fetch: unknown.fetch,
  });
  await unlisted.transcribe(new Float32Array(16_000).fill(0.1), { vocabulary: many });
  assert.equal(unknown.requests[0].body.messages.length, 1);
});
