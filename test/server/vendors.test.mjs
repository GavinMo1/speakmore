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

test("按 id 找，大小写不论；不认识的是 null", () => {
  assert.equal(findVendor("DeepSeek").keyEnv, "DEEPSEEK_API_KEY");
  assert.equal(findVendor("gemini").keyEnv, "GEMINI_API_KEY");
  assert.equal(findVendor("custom").keyPage, null);
  assert.equal(findVendor("nobody"), null);
});
