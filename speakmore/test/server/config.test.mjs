import assert from "node:assert/strict";
import { test } from "node:test";
import { apiKeyProblem, loadConfig } from "../../src/server/config.mjs";

test("只给密钥时，其余用默认值，只监听本机", () => {
  assert.deepEqual(loadConfig({ GEMINI_API_KEY: "k" }), {
    host: "127.0.0.1",
    port: 8790,
    gemini: { apiKey: "k", model: "gemini-3.5-flash", thinkingLevel: "MINIMAL", timeoutMs: 30000 },
  });
});

test("环境变量可以换端口、模型和思考档位", () => {
  const config = loadConfig({
    GEMINI_API_KEY: "k",
    PORT: "9001",
    GEMINI_MODEL: "gemini-3.8-flash",
    GEMINI_THINKING_LEVEL: "low",
  });
  assert.equal(config.port, 9001);
  assert.equal(config.gemini.model, "gemini-3.8-flash");
  assert.equal(config.gemini.thinkingLevel, "LOW");
});

test("没有密钥时报错，并说明怎么给", () => {
  assert.throws(() => loadConfig({}), /GEMINI_API_KEY/);
  assert.throws(() => loadConfig({ GEMINI_API_KEY: "  " }), /GEMINI_API_KEY/);
});

test("端口和思考档位写错时报错，不悄悄用默认值", () => {
  for (const PORT of ["abc", "0", "70000", "80.5"]) {
    assert.throws(() => loadConfig({ GEMINI_API_KEY: "k", PORT }), /PORT/);
  }
  assert.throws(() => loadConfig({ GEMINI_API_KEY: "k", GEMINI_THINKING_LEVEL: "none" }), /GEMINI_THINKING_LEVEL/);
});

test("key 的样子：只该有看得见的英文字符；不对时说哪里不对，句子里不带 key 本身", () => {
  assert.equal(apiKeyProblem("AIzaSy-not_a.real-key"), null);
  // 管道喂进多行内容、复制时带上了别的字，都是这一类
  for (const bad of [
    "line-one-SECRET\nline-two-SECRET",
    "has SECRET space",
    "tab\tSECRET",
    "钥匙SECRET",
    "x-SECRET\u0007",
  ]) {
    const problem = apiKeyProblem(bad);
    assert.equal(typeof problem, "string");
    assert.doesNotMatch(problem, /SECRET/);
  }
  assert.match(apiKeyProblem("a b"), /空格或换行/);
  assert.match(apiKeyProblem("k".repeat(600)), /太长/);
});

test("样子不对的 key 直接拒绝，不交给 Gemini 的 SDK：它报错时会把整段输入带出来", () => {
  assert.throws(
    () => loadConfig({ GEMINI_API_KEY: "line-one-SECRET\nline-two-SECRET" }),
    (error) => /GEMINI_API_KEY/.test(error.message) && !/SECRET/.test(error.message),
  );
});
