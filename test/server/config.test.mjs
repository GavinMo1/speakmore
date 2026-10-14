import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../../src/server/config.mjs";

test("只给 Gemini 的密钥时，其余用默认值，只监听本机", () => {
  assert.deepEqual(loadConfig({ GEMINI_API_KEY: "k" }), {
    host: "127.0.0.1",
    port: 8790,
    model: { provider: "gemini", model: "gemini-3.5-flash" },
    apiKey: "k",
    thinkingLevel: "MINIMAL",
  });
});

test("SPEAKMORE_MODEL 选厂商和模型，key 从那一家的环境变量来", () => {
  const config = loadConfig({ SPEAKMORE_MODEL: "openai/gpt-audio-1.5", OPENAI_API_KEY: "sk-test" });
  assert.deepEqual(config.model, { provider: "openai", model: "gpt-audio-1.5" });
  assert.equal(config.apiKey, "sk-test");
  // 选了 OpenAI 却只给了 Gemini 的 key：说清缺的是哪一个
  assert.throws(() => loadConfig({ SPEAKMORE_MODEL: "openai", GEMINI_API_KEY: "k" }), /OPENAI_API_KEY/);
});

test("环境变量可以换端口和思考档位；旧的 GEMINI_MODEL 照样认，SPEAKMORE_MODEL 优先", () => {
  const config = loadConfig({
    GEMINI_API_KEY: "k",
    PORT: "9001",
    GEMINI_MODEL: "gemini-3.8-flash",
    GEMINI_THINKING_LEVEL: "low",
  });
  assert.equal(config.port, 9001);
  assert.deepEqual(config.model, { provider: "gemini", model: "gemini-3.8-flash" });
  assert.equal(config.thinkingLevel, "LOW");
  const both = loadConfig({ SPEAKMORE_MODEL: "openai", GEMINI_MODEL: "gemini-3.8-flash", OPENAI_API_KEY: "k" });
  assert.equal(both.model.provider, "openai");
});

test("没有密钥时报错，并说明怎么给", () => {
  assert.throws(() => loadConfig({}), /GEMINI_API_KEY/);
  assert.throws(() => loadConfig({ GEMINI_API_KEY: "  " }), /GEMINI_API_KEY/);
});

test("端口、模型和思考档位写错时报错，说清是哪个环境变量，不悄悄用默认值", () => {
  for (const PORT of ["abc", "0", "70000", "80.5"]) {
    assert.throws(() => loadConfig({ GEMINI_API_KEY: "k", PORT }), /PORT/);
  }
  assert.throws(() => loadConfig({ GEMINI_API_KEY: "k", GEMINI_THINKING_LEVEL: "none" }), /GEMINI_THINKING_LEVEL/);
  assert.throws(() => loadConfig({ GEMINI_API_KEY: "k", SPEAKMORE_MODEL: "deepseek/x" }), /SPEAKMORE_MODEL.*deepseek/);
});

test("样子不对的 key 直接拒绝，不交给 SDK：它报错时会把整段输入带出来", () => {
  assert.throws(
    () => loadConfig({ GEMINI_API_KEY: "line-one-SECRET\nline-two-SECRET" }),
    (error) => /GEMINI_API_KEY/.test(error.message) && !/SECRET/.test(error.message),
  );
});

test("模型的环境变量是空的：当作没设，用默认的（0.3 单独启动服务端时就是这样）", () => {
  assert.deepEqual(loadConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "" }).model, {
    provider: "gemini",
    model: "gemini-3.5-flash",
  });
  assert.equal(loadConfig({ GEMINI_API_KEY: "k", SPEAKMORE_MODEL: " " }).model.provider, "gemini");
});
