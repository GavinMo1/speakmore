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
