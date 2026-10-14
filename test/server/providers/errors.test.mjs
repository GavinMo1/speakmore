import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelError, toModelError } from "../../../src/server/providers/errors.mjs";

const OpenAI = { name: "OpenAI" };

test("够不着厂商（没网、超时、被取消）算暂时用不了，话里点名是哪一家", () => {
  for (const error of [
    new TypeError("fetch failed"),
    new DOMException("This operation was aborted", "AbortError"),
    new DOMException("The operation was aborted due to timeout", "TimeoutError"),
  ]) {
    const described = toModelError(error, { provider: OpenAI });
    assert.ok(described instanceof ModelError);
    assert.equal(described.kind, "unavailable");
    assert.equal(described.message, "连不上 OpenAI，检查网络后再试");
  }
});

test("各家自己认得的报错交给它分类；它不认得的，原话截短了给人看", () => {
  const classify = (error) => (error.status === 401 ? { kind: "key", problem: "这把 key 无效" } : null);
  const rejected = toModelError(Object.assign(new Error("401 nope"), { status: 401 }), { provider: OpenAI, classify });
  assert.deepEqual([rejected.kind, rejected.message, rejected.detail], ["key", "这把 key 无效", "401 nope"]);

  const unknown = toModelError(new Error("x".repeat(500)), { provider: OpenAI, classify });
  assert.equal(unknown.kind, "other");
  assert.ok(unknown.message.length <= 200);
  assert.equal(unknown.detail.length, 500);
});

test("报错里带着 key 本身时先抹掉：给用户看的话和留给日志的原文里都没有它", () => {
  // 实测：带换行的 key 交给 Gemini 的 SDK，报的就是这一句，引号里是整段输入
  const key = "line-one-SECRET\nline-two-SECRET";
  const leaked = new TypeError(`Headers.append: "${key}" is an invalid header value.`);
  const described = toModelError(leaked, { provider: OpenAI, apiKey: key });
  assert.doesNotMatch(described.message + described.detail, /SECRET/);
  assert.match(described.detail, /invalid header value/);
});

test("已经分好类的原样交回，不再包一层", () => {
  const error = new ModelError({ kind: "key", problem: "这把 key 无效", detail: "401" });
  assert.equal(toModelError(error, { provider: OpenAI }), error);
});
