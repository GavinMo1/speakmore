import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOUD_TRANSCRIBERS } from "../../src/server/asr/cloud/vendors.mjs";
import { CHAT_VENDORS } from "../../src/server/chat/vendors.mjs";
import { PROVIDERS } from "../../src/server/providers/index.mjs";
import { findVendor, VENDORS } from "../../src/server/vendors.mjs";

test("要给 key 的每一家：原生、润色、云端转写的都在，同一家只出现一次（百炼三个角色共用一把）", () => {
  const ids = VENDORS.map(({ id }) => id);
  assert.deepEqual(ids, [...new Set([...PROVIDERS, ...CHAT_VENDORS, ...CLOUD_TRANSCRIBERS].map(({ id }) => id))]);
  assert.equal(ids.filter((id) => id === "bailian").length, 1);
  for (const vendor of VENDORS) {
    assert.ok(vendor.name && vendor.keyEnv, vendor.id);
  }
});

test("同一家在几个角色里登记的环境变量、申请页一样：合并时只留先合进来的那项，key 也只存一把", () => {
  for (const vendor of VENDORS) {
    for (const entry of [...PROVIDERS, ...CHAT_VENDORS, ...CLOUD_TRANSCRIBERS].filter(({ id }) => id === vendor.id)) {
      assert.equal(entry.keyEnv, vendor.keyEnv, vendor.id);
      assert.equal(entry.keyPage, vendor.keyPage, vendor.id);
    }
  }
});

test("按 id 找，大小写不论；不认识的是 null", () => {
  assert.equal(findVendor("DeepSeek").keyEnv, "DEEPSEEK_API_KEY");
  assert.equal(findVendor("gemini").keyEnv, "GEMINI_API_KEY");
  assert.equal(findVendor("custom").keyPage, null);
  assert.equal(findVendor("nobody"), null);
});

/** 价目接口没给价的型号：模型广场上这一格空着（见 chat/prices/bailian.mjs 开头） */
const UNPRICED = ["polish bailian/qwen3.7-plus"];

test("每一家都有价目模块，清单里的每个型号都标得出价；标不出的写明在 UNPRICED", async () => {
  const roles = { native: PROVIDERS, polish: CHAT_VENDORS, transcribe: CLOUD_TRANSCRIBERS };
  for (const [role, registry] of Object.entries(roles)) {
    // 自定义服务没有清单，价也不知道
    for (const vendor of registry.filter(({ models }) => models.length > 0)) {
      assert.equal(typeof vendor.prices, "function", `${role} ${vendor.id} 没有价目模块`);
      const { listPrice } = await vendor.prices();
      assert.equal(typeof listPrice, "function", `${role} ${vendor.id} 的价目模块没有 listPrice`);
      for (const model of vendor.models) {
        const id = `${role} ${vendor.id}/${model.id}`;
        if (UNPRICED.includes(id)) assert.equal(listPrice(model.id), null, id);
        else assert.ok(listPrice(model.id), `${id} 标不出价`);
      }
    }
  }
});
