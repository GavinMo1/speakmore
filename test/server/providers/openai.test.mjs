import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIO_TYPES, classifyError, createClient } from "../../../src/server/providers/openai.mjs";

/** 假的 fetch：记下请求，按给定的状态码和内容回话 */
function fakeFetch(status, body) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch, requests };
}

const completion = (content, finish_reason = "stop", extra = {}) => ({
  choices: [{ finish_reason, message: { role: "assistant", content, refusal: null, ...extra } }],
});

const WAV = Buffer.from("RIFF fake wav");

test("OpenAI 只收 wav（实测 webm、ogg 都回 400），录音要先换格式", () => {
  assert.deepEqual(AUDIO_TYPES, ["audio/wav"]);
});

test("整理：系统提示词、录音、跟在录音后面的那句话一起发；只要文字，不要它说话", async () => {
  const { fetch, requests } = fakeFetch(200, completion("整理好的文字"));
  const client = createClient({ apiKey: "sk-test", model: "gpt-audio-1.5", fetch });
  const signal = new AbortController().signal;
  const text = await client.generate({
    audio: WAV,
    mimeType: "audio/wav",
    systemPrompt: "系统提示词",
    reminder: "只输出成品。",
    signal,
  });
  assert.equal(text, "整理好的文字");

  const [{ url, init, body }] = requests;
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer sk-test");
  assert.equal(init.signal, signal);
  assert.deepEqual(body, {
    model: "gpt-audio-1.5",
    modalities: ["text"],
    messages: [
      { role: "system", content: "系统提示词" },
      {
        role: "user",
        content: [
          { type: "input_audio", input_audio: { data: WAV.toString("base64"), format: "wav" } },
          { type: "text", text: "只输出成品。" },
        ],
      },
    ],
  });
});

test("被截断、被拦下的半截文字不能当成品：没有正常结束或者它拒绝了，都报错", async () => {
  for (const [reply, pattern] of [
    [completion("说到一半", "length"), /没有正常结束：length/],
    [completion("", "content_filter"), /没有正常结束：content_filter/],
    [completion(null, "stop", { refusal: "I can't help with that." }), /没有处理这段录音：I can't help with that/],
  ]) {
    const { fetch } = fakeFetch(200, reply);
    const client = createClient({ apiKey: "k", model: "m", fetch });
    await assert.rejects(
      client.generate({ audio: WAV, mimeType: "audio/wav", systemPrompt: "", reminder: "" }),
      pattern,
    );
  }
});

test("验证 key 发一个最小的请求：0.1 秒静音、只要 1 个 token。文字请求不行，这几个模型要求带音频（实测 400）", async () => {
  // 只要 1 个 token，它回的 finish_reason 就是 length：这不算失败
  const { fetch, requests } = fakeFetch(200, completion("", "length"));
  await createClient({ apiKey: "k", model: "gpt-audio-mini", fetch }).ping({});
  const [{ body }] = requests;
  assert.equal(body.model, "gpt-audio-mini");
  assert.equal(body.max_completion_tokens, 1);
  const [part] = body.messages[0].content;
  assert.equal(part.type, "input_audio");
  assert.equal(part.input_audio.format, "wav");
  const wav = Buffer.from(part.input_audio.data, "base64");
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.ok(wav.length < 10_000);
});

/** 实测到的 OpenAI 报错：HTTP 状态码 + { error: { message, type, code } } */
async function failWith(status, error) {
  const { fetch } = fakeFetch(status, { error });
  const client = createClient({ apiKey: "k", model: "m", fetch });
  try {
    await client.ping({});
  } catch (thrown) {
    return { thrown, classified: classifyError(thrown) };
  }
  throw new Error("应该失败");
}

test("key 不对（401）或者账号没额度：都是换一把 key 能解决的", async () => {
  const invalid = await failWith(401, {
    message:
      "Incorrect API key provided: sk-proj-***0000. You can find your API key at https://platform.openai.com/account/api-keys.",
    type: "invalid_request_error",
    code: "invalid_api_key",
  });
  assert.deepEqual(invalid.classified, { kind: "key", problem: "这把 key 无效，检查有没有复制完整" });

  const broke = await failWith(429, {
    message: "You exceeded your current quota, please check your plan and billing details.",
    type: "insufficient_quota",
    code: "insufficient_quota",
  });
  assert.equal(broke.classified.kind, "key");
  assert.match(broke.classified.problem, /额度/);
});

test("限流和它那边出状况：暂时用不了，过一会儿再试", async () => {
  const limited = await failWith(429, { message: "Rate limit reached for requests.", code: "rate_limit_exceeded" });
  assert.deepEqual(limited.classified, {
    kind: "unavailable",
    problem: "OpenAI 暂时用不了（Rate limit reached for requests），过一会儿再试",
  });
  assert.equal((await failWith(503, { message: "Service unavailable." })).classified.kind, "unavailable");
});

test("模型名写错（404）和别的请求问题：说清是 OpenAI 拒绝的、它怎么说的", async () => {
  const missing = await failWith(404, {
    message: "The model `gpt-audio-9` does not exist or you do not have access to it.",
    type: "invalid_request_error",
    code: "model_not_found",
  });
  assert.equal(missing.classified.kind, "other");
  assert.match(missing.classified.problem, /^OpenAI 没有这个模型，或者这把 key 用不了它：The model `gpt-audio-9`/);

  const bad = await failWith(400, {
    message: "This model does not support the format you provided.",
    code: "unsupported_format",
  });
  assert.deepEqual(bad.classified, {
    kind: "other",
    problem: "OpenAI 拒绝了请求：This model does not support the format you provided",
  });
});

test("回的不是 JSON（比如中间的网关回了一页 HTML）也能说清状态码", async () => {
  const fetch = async () => new Response("<html>Bad Gateway</html>", { status: 502 });
  const client = createClient({ apiKey: "k", model: "m", fetch });
  const error = await client.ping({}).catch((thrown) => thrown);
  assert.match(error.message, /502/);
  assert.equal(classifyError(error).kind, "unavailable");
});

test("不是 OpenAI 回的报错不认，交给通用的分类", () => {
  assert.equal(classifyError(new TypeError("fetch failed")), null);
});

test("所在地区不支持（403 unsupported_country_region_territory）：是网络出口的问题，不叫人换 key", async () => {
  const region = await failWith(403, {
    message: "Country, region, or territory not supported",
    type: "request_forbidden",
    code: "unsupported_country_region_territory",
  });
  assert.equal(region.classified.kind, "unavailable");
  assert.match(region.classified.problem, /地区/);
  assert.match(region.classified.problem, /代理/);
});

test("回的不是 JSON 的 4xx（比如网关回 413）：说明里至少有状态码，不是一句空话", async () => {
  for (const status of [400, 413]) {
    const fetch = async () => new Response("<html>nope</html>", { status });
    const error = await createClient({ apiKey: "k", model: "m", fetch })
      .ping({})
      .catch((thrown) => thrown);
    assert.match(classifyError(error).problem, new RegExp(`HTTP ${status}$`));
  }
});
