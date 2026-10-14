import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIO_TYPES, classifyError } from "../../../src/server/providers/gemini.mjs";

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
