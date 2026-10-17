import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, describePlaza, loadPriceBook } from "../../src/app/model-plaza.mjs";
import { CLOUD_TRANSCRIBERS } from "../../src/server/asr/cloud/vendors.mjs";
import { CHAT_VENDORS } from "../../src/server/chat/vendors.mjs";
import { PROVIDERS } from "../../src/server/providers/index.mjs";

const view = async (overrides = {}) =>
  describePlaza({
    mode: "local",
    chosen: { native: DEFAULTS.native, transcriber: DEFAULTS.transcribe, polish: DEFAULTS.polish, customUrl: "" },
    keys: { deepseek: "stored", bailian: "env" },
    status: { "qwen3-asr-0.6b-q8": { installed: true, download: null, partial: 0, problem: null } },
    chip: "apple-silicon",
    freeBytes: 446e9,
    priceOf: await loadPriceBook(),
    ...overrides,
  });

const group = (shelf, id) => shelf.find((found) => found.id === id);

test("润色按谁做的分组：DeepSeek 官方和百炼都卖的并成一行，两个平台是这一组的渠道", async () => {
  const { shelves } = await view();
  const deepseek = group(shelves.polish, "deepseek");
  assert.deepEqual(deepseek.channels, ["deepseek", "bailian"]);
  const flash = deepseek.items.find(({ name }) => name === "DeepSeek V4.1 Flash");
  assert.equal(flash.offers.deepseek.choice, "deepseek/deepseek-flash");
  assert.equal(flash.offers.bailian.choice, "bailian/deepseek-v4.1-flash");
  // 各渠道的标价各自的币种
  assert.equal(flash.offers.deepseek.price.currency, "USD");
  assert.equal(flash.offers.bailian.price.currency, "CNY");
  // 出厂默认、跑过评测
  assert.deepEqual(
    flash.tags.map(({ kind }) => kind),
    ["default", "tested"],
  );
  // 自定义服务在最后
  assert.equal(shelves.polish.at(-1).kind, "custom");
});

test("原生：已知问题打成标签；百炼的 Omni 在通义那一组、按人民币标价", async () => {
  const { shelves } = await view();
  const openai = group(shelves.native, "openai");
  assert.deepEqual(openai.items.find(({ name }) => name === "GPT Audio 1.5").tags, [
    { kind: "issue", issue: "jsonWrapped" },
  ]);
  const qwen = group(shelves.native, "qwen");
  assert.deepEqual(qwen.channels, ["bailian"]);
  assert.deepEqual(qwen.items[0].offers.bailian.price, { currency: "CNY", input: 0.8, output: 2.7 });
});

test("转写：本机一组在前（规格取这类芯片上最快的那次实测、带下载状态），云端按谁做的分组、标每小时的价", async () => {
  const { shelves } = await view();
  const [local, ...cloud] = shelves.transcribe;
  assert.equal(local.kind, "local");
  const q8 = local.items.find(({ choice }) => choice === "qwen3-asr-0.6b-q8");
  assert.equal(q8.name, "Qwen3-ASR 0.6B");
  assert.equal(q8.variant, "Q8_0");
  assert.equal(q8.backend, "metal");
  assert.equal(q8.installed, true);
  assert.equal(q8.specs.zh, 4.32);
  assert.ok(Math.abs(q8.specs.minuteSeconds - 60 / 67.5) < 1e-9);
  assert.deepEqual(
    q8.tags.map(({ kind }) => kind),
    ["default"],
  );
  // 没装的照样列出来，状态是没装
  assert.equal(local.items.find(({ choice }) => choice === "sensevoice-small-q8").installed, false);
  const qwen = cloud.find(({ id }) => id === "qwen");
  assert.deepEqual(qwen.channels, ["bailian"]);
  const flash = qwen.items.find(({ name }) => name === "Qwen3 ASR Flash");
  assert.deepEqual(flash.offers.bailian.price, { currency: "CNY", perHour: 0.79, approx: false });
});

test("密钥表：每个平台一行，key 在哪、三排货架上各有几个；百炼排第一，自定义服务最后", async () => {
  const { platforms } = await view();
  assert.equal(platforms[0].id, "bailian");
  assert.equal(platforms.at(-1).id, "custom");
  const bailian = platforms[0];
  assert.equal(bailian.key, "env");
  assert.deepEqual(bailian.coverage, { native: 4, transcribe: 4, polish: 6 });
  assert.equal(platforms.find(({ id }) => id === "gemini").key, null);
});

test("拿不到的价是 null，不编一个", async () => {
  const { shelves } = await view();
  const plus = group(shelves.polish, "qwen").items.find(({ name }) => name === "Qwen3.7 Plus");
  assert.equal(plus.offers.bailian.price, null);
});

test("没拿真 key 调过的型号：那个渠道的一项照清单记着未验证，验过的不记；不算这一行的标签", async () => {
  const { shelves } = await view();
  const registries = { transcribe: CLOUD_TRANSCRIBERS, polish: CHAT_VENDORS, native: PROVIDERS };
  let offers = 0;
  for (const [role, registry] of Object.entries(registries)) {
    const listed = new Map(registry.flatMap((v) => v.models.map((m) => [`${v.id}/${m.id}`, Boolean(m.unverified)])));
    for (const item of shelves[role].filter(({ kind }) => kind === "cloud").flatMap(({ items }) => items)) {
      // 未验证跟着渠道走，不是这一行的标签：同一个模型换一家卖，可能就验过了
      assert.ok(!item.tags.some(({ kind }) => kind === "unverified"), item.name);
      for (const offer of Object.values(item.offers)) {
        assert.equal(offer.unverified, listed.get(offer.choice), offer.choice);
        offers += 1;
      }
    }
  }
  assert.ok(offers > 20);
});
