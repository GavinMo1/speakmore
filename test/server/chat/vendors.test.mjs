import assert from "node:assert/strict";
import { test } from "node:test";
import { createTranslator } from "../../../src/i18n/index.mjs";
import {
  CHAT_VENDORS,
  chatEndpoint,
  findChatVendor,
  formatChatChoice,
  normalizeBaseUrl,
  PROTOCOLS,
  parseChatChoice,
  requestFor,
} from "../../../src/server/chat/vendors.mjs";

const zh = createTranslator("zh-CN");
const problem = (fn) => {
  try {
    fn();
  } catch (error) {
    return zh.text(error.problem);
  }
  assert.fail("应该抛错");
};
/** 写错时报的那句话里说到了什么 */
const says = (fn, pattern) => assert.match(problem(fn), pattern);

test("每一家说的协议都登记了；登记了地址的是 https", () => {
  for (const vendor of CHAT_VENDORS) {
    assert.ok(PROTOCOLS[vendor.protocol], `${vendor.id} 的协议 ${vendor.protocol} 没有登记`);
    if (vendor.baseUrl !== null) assert.match(vendor.baseUrl, /^https:\/\//);
    assert.match(vendor.id, /^[a-z0-9]+$/, "id 要能当 key 文件名");
  }
});

test("只写厂商：用它的默认模型；写了模型照写的来，模型名里可以有斜杠和冒号", () => {
  assert.deepEqual(parseChatChoice("deepseek"), { vendor: "deepseek", model: "deepseek-flash" });
  assert.deepEqual(parseChatChoice(" DeepSeek/deepseek-v4-pro "), { vendor: "deepseek", model: "deepseek-v4-pro" });
  // OpenRouter、SiliconFlow 的模型名带斜杠，Ollama 的带冒号
  assert.deepEqual(parseChatChoice("custom/Qwen/Qwen3-8B"), { vendor: "custom", model: "Qwen/Qwen3-8B" });
  assert.deepEqual(parseChatChoice("custom/qwen3:8b"), { vendor: "custom", model: "qwen3:8b" });
  assert.equal(formatChatChoice({ vendor: "custom", model: "Qwen/Qwen3-8B" }), "custom/Qwen/Qwen3-8B");
});

test("清单里没有的模型名也照样认：由那一家判断有没有", () => {
  assert.deepEqual(parseChatChoice("deepseek/deepseek-v5"), { vendor: "deepseek", model: "deepseek-v5" });
});

test("写错时说清哪里不对", () => {
  says(() => parseChatChoice(""), /空/);
  says(() => parseChatChoice("nobody/x"), /nobody/);
  says(() => parseChatChoice("nobody/x"), /deepseek/);
  // 自定义的没有默认模型
  says(() => parseChatChoice("custom"), /模型/);
  says(() => parseChatChoice("deepseek/has space"), /has space/);
});

test("地址：去掉结尾的斜杠和多贴的 /chat/completions；只认 http(s)，不许带账号密码、查询串", () => {
  assert.equal(normalizeBaseUrl("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.equal(normalizeBaseUrl(" https://api.example.com/v1/chat/completions "), "https://api.example.com/v1");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:11434/v1"), "http://127.0.0.1:11434/v1");
  says(() => normalizeBaseUrl(""), /空/);
  says(() => normalizeBaseUrl("api.example.com"), /http/);
  says(() => normalizeBaseUrl("ftp://api.example.com"), /http/);
  says(() => normalizeBaseUrl("https://user:pass@api.example.com"), /账号/);
  says(() => normalizeBaseUrl("https://api.example.com/v1?key=1"), /\?/);
});

test("接口地址：登记了的用登记的；自定义的用用户填的，名字是它的主机名（报错时说是哪一家）", () => {
  assert.deepEqual(chatEndpoint(findChatVendor("deepseek"), {}), {
    baseUrl: "https://api.deepseek.com",
    name: "DeepSeek",
  });
  assert.deepEqual(chatEndpoint(findChatVendor("custom"), { customUrl: "https://api.siliconflow.cn/v1" }), {
    baseUrl: "https://api.siliconflow.cn/v1",
    name: "api.siliconflow.cn",
  });
  says(() => chatEndpoint(findChatVendor("custom"), {}), /地址/);
});

test("清单里的模型一项一个：id 不重复，有名字和出自哪家；默认模型在清单里", () => {
  for (const vendor of CHAT_VENDORS) {
    const ids = vendor.models.map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length, `${vendor.id} 的模型有重复`);
    for (const model of vendor.models) {
      assert.ok(model.name && model.maker, `${vendor.id}/${model.id} 缺名字或出处`);
      assert.ok(Object.isFrozen(model), `${vendor.id}/${model.id} 没冻上`);
    }
    if (vendor.defaultModel !== null) assert.ok(ids.includes(vendor.defaultModel), `${vendor.id} 的默认模型不在清单里`);
  }
});

test("每个模型要带的参数：这一家都带的加上模型自己的；清单外的模型只带这一家的", () => {
  const vendor = {
    request: { enable_thinking: false, temperature: 1 },
    models: [{ id: "a", request: { temperature: 0.7 } }, { id: "b" }],
  };
  assert.deepEqual(requestFor(vendor, "a"), { enable_thinking: false, temperature: 0.7 });
  assert.deepEqual(requestFor(vendor, "b"), { enable_thinking: false, temperature: 1 });
  assert.deepEqual(requestFor(vendor, "elsewhere"), { enable_thinking: false, temperature: 1 });
});

test("百炼润色的模型都关思考，用的是国内站的兼容地址", () => {
  const bailian = findChatVendor("bailian");
  assert.equal(bailian.baseUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1");
  for (const { id } of bailian.models) assert.equal(requestFor(bailian, id).enable_thinking, false, id);
  assert.deepEqual(parseChatChoice("bailian"), { vendor: "bailian", model: "qwen3.8-flash" });
});

test("Kimi 官方：国内站地址，每个模型都关思考；只能开着思考的代码模型不在清单里", () => {
  const moonshot = findChatVendor("moonshot");
  assert.equal(moonshot.baseUrl, "https://api.moonshot.cn/v1");
  for (const { id } of moonshot.models) {
    assert.deepEqual(requestFor(moonshot, id), { thinking: { type: "disabled" } }, id);
  }
  assert.ok(!moonshot.models.some(({ id }) => id.startsWith("kimi-k2.7-code")));
  assert.deepEqual(parseChatChoice("moonshot"), { vendor: "moonshot", model: "kimi-k2.6" });
});
