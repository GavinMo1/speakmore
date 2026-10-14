import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIO_TYPES, classifyError, replyOf } from "../../../src/server/providers/gemini.mjs";

/** 和 SDK 抛的一样：message 是 Gemini 回的整段 JSON，status 是 HTTP 状态码 */
function apiError(code, message, status) {
  return Object.assign(new Error(JSON.stringify({ error: { code, message, status } })), {
    name: "ApiError",
    status: code,
  });
}
const classify = (error) => classifyError(error, String(error.message));

test("Gemini 直接收悬浮条录的 WebM 和原版的 Ogg，不用转格式", () => {
  assert.deepEqual(AUDIO_TYPES, ["audio/ogg", "audio/webm"]);
});

test("key 不对：说这把 key 无效", () => {
  // 实测到的假 key 报错
  const invalid = new Error(
    '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}',
  );
  assert.deepEqual(classify(invalid), { kind: "key", problem: "这把 key 无效，检查有没有复制完整" });
});

test("Gemini 自己出了状况或者限流：和 key、和设置都没关系，过一会儿就好", () => {
  assert.deepEqual(classify(apiError(503, "The service is currently unavailable.", "UNAVAILABLE")), {
    kind: "unavailable",
    problem: "Gemini 暂时用不了（The service is currently unavailable），过一会儿再试",
  });
  assert.equal(classify(apiError(500, "Internal error.", "INTERNAL")).kind, "unavailable");
  assert.equal(classify(apiError(429, "Resource exhausted.", "RESOURCE_EXHAUSTED")).kind, "unavailable");
});

test("Gemini 拒绝了请求（多半是模型名或档位）：只带它说的那句话，不带整段 JSON", () => {
  const other = classify(
    apiError(
      404,
      "models/gemini-no-such-model is not found for API version v1beta, or is not supported for generateContent.",
      "NOT_FOUND",
    ),
  );
  assert.equal(other.kind, "other");
  // 句尾的句号去掉，后面还要接别的话
  assert.match(other.problem, /^Gemini 拒绝了请求：models\/gemini-no-such-model is not found.*generateContent$/);
  assert.doesNotMatch(other.problem, /"code"/);
});

test("不是 Gemini 回的报错不认，交给通用的分类", () => {
  assert.equal(classify(new TypeError("fetch failed")), null);
  assert.equal(classify(new Error("Gemini 没有正常结束：MAX_TOKENS")), null);
});

// ---------- 回话里的用量：多少 token、按哪个型号、花了多少钱 ----------

const OCT = new Date("2026-10-14T08:00:00Z");

/** 一次真实的听写回话（2026-10-14 实测，请求的是 gemini-3.5-flash，被转给了 3.6 Flash） */
const dictation = (overrides = {}) => ({
  text: "<无人声>",
  modelVersion: "gemini-3.6-flash",
  candidates: [{ finishReason: "STOP" }],
  usageMetadata: {
    promptTokenCount: 1390,
    candidatesTokenCount: 4,
    totalTokenCount: 1394,
    promptTokensDetails: [
      { modality: "AUDIO", tokenCount: 25 },
      { modality: "TEXT", tokenCount: 1365 },
    ],
    serviceTier: "standard",
  },
  ...overrides,
});

test("回话里带着用量：按实际回话的型号算钱（请求 3.5 Flash，回话的是 3.6 Flash）", () => {
  assert.deepEqual(replyOf(dictation(), { model: "gemini-3.5-flash", at: OCT }), {
    text: "<无人声>",
    problem: null,
    usage: {
      model: "gemini-3.6-flash",
      inputTokens: 1390,
      audioTokens: 25,
      cachedTokens: 0,
      outputTokens: 4,
      thinkingTokens: 0,
      costUsd: (1390 * 0.75 + 4 * 3.75) / 1e6,
    },
  });
});

test("思考的 token 算进输出；命中缓存的照报，价按缓存价", () => {
  const { usage } = replyOf(
    dictation({
      modelVersion: "gemini-2.5-flash",
      usageMetadata: {
        promptTokenCount: 1390,
        cachedContentTokenCount: 1024,
        candidatesTokenCount: 50,
        thoughtsTokenCount: 30,
        promptTokensDetails: [
          { modality: "TEXT", tokenCount: 1365 },
          { modality: "AUDIO", tokenCount: 25 },
        ],
        cacheTokensDetails: [{ modality: "TEXT", tokenCount: 1024 }],
      },
    }),
    { model: "gemini-2.5-flash", at: OCT },
  );
  assert.equal(usage.outputTokens, 80);
  assert.equal(usage.thinkingTokens, 30);
  assert.equal(usage.cachedTokens, 1024);
  assert.ok(Math.abs(usage.costUsd - (341 * 0.3 + 1024 * 0.03 + 25 * 1 + 80 * 2.5) / 1e6) < 1e-12);
});

test("回话没报型号就按请求的型号算；价目表里没有的型号算不出钱，token 照记", () => {
  assert.equal(
    replyOf(dictation({ modelVersion: undefined }), { model: "gemini-2.5-flash", at: OCT }).usage.model,
    "gemini-2.5-flash",
  );
  const { usage } = replyOf(dictation({ modelVersion: "gemini-9-ultra" }), { model: "gemini-9-ultra", at: OCT });
  assert.equal(usage.costUsd, null);
  assert.equal(usage.inputTokens, 1390);
});

test("被拦下、没正常结束的回话不能当成品，但用量照样带回来：这一次是收了钱的", () => {
  const blocked = replyOf(dictation({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, candidates: [] }), {
    model: "gemini-3.6-flash",
    at: OCT,
  });
  assert.equal(blocked.problem, "Gemini 没有处理这段录音：PROHIBITED_CONTENT");
  assert.equal(blocked.text, null);
  assert.equal(blocked.usage.inputTokens, 1390);

  const cut = replyOf(dictation({ candidates: [{ finishReason: "MAX_TOKENS" }] }), {
    model: "gemini-3.6-flash",
    at: OCT,
  });
  assert.equal(cut.problem, "Gemini 没有正常结束：MAX_TOKENS");
  assert.equal(cut.text, null);
});

test("用量缺项时按 0 算（实测验证 key 的最小请求只报了输入）", () => {
  const ping = { modelVersion: "gemini-3.6-flash", usageMetadata: { promptTokenCount: 2, totalTokenCount: 2 } };
  assert.deepEqual(replyOf(ping, { model: "gemini-3.6-flash", at: OCT }).usage, {
    model: "gemini-3.6-flash",
    inputTokens: 2,
    audioTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    costUsd: (2 * 0.75) / 1e6,
  });
});
