import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, describePlaza, loadPriceBook } from "../../src/app/model-plaza.mjs";
import { presetsFor } from "../../src/models/presets.mjs";
import { CLOUD_TRANSCRIBERS } from "../../src/server/asr/cloud/vendors.mjs";
import { CHAT_VENDORS } from "../../src/server/chat/vendors.mjs";
import { CNY_PER_USD } from "../../src/server/currency.mjs";
import { PROVIDERS } from "../../src/server/providers/index.mjs";
import { patchSettings, resolveSettings, routeOf } from "../../src/storage/settings.mjs";

const view = async (overrides = {}) =>
  describePlaza({
    mode: "local",
    chosen: { native: DEFAULTS.native, transcriber: DEFAULTS.transcribe, polish: DEFAULTS.polish, customUrl: "" },
    keys: { deepseek: "stored", bailian: "env" },
    status: { "qwen3-asr-0.6b-q8": { installed: true, download: null, partial: 0, problem: null } },
    chip: "apple-silicon",
    freeBytes: 446e9,
    prices: await loadPriceBook(),
    routes: routesWith({}),
    presets: [],
    at: new Date("2026-10-19T02:30:00Z"),
    ...overrides,
  });

const settingsWith = (changes) =>
  patchSettings(resolveSettings({ file: "/nonexistent/settings.json", env: {} }), changes);

/** 三种方式按出厂设置加上 changes 走哪条路线（同主进程：storage/settings.mjs 的 routeOf） */
function routesWith(changes) {
  const settings = settingsWith(changes);
  return Object.fromEntries(["native", "local", "private"].map((mode) => [mode, routeOf(settings, mode)]));
}

/** 适合这类芯片的推荐组合，各按设置换上它那几项之后的路线（同主进程） */
const presetsWith = (changes, chip) =>
  presetsFor(chip).map((preset) => ({
    preset,
    route: routeOf(settingsWith({ ...changes, ...preset.settings }), preset.mode),
  }));

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

test("三种识别方式：一路经过哪几个模型（名字取清单里的），切过去之前还差什么（缺的 key、没下载的本机模型）", async () => {
  const { ways } = await view({
    routes: routesWith({
      model: "openai",
      transcriber: "bailian/qwen3-asr-flash",
      privateTranscriber: "sensevoice-small-q8",
    }),
    keys: { deepseek: "stored" },
  });
  const openai = PROVIDERS.find(({ id }) => id === "openai");
  assert.deepEqual(ways.native.hops, [
    {
      role: "native",
      platform: "openai",
      maker: "openai",
      name: openai.models.find(({ id }) => id === openai.defaultModel).name,
    },
  ]);
  assert.deepEqual(ways.native.needs, [{ kind: "key", platform: "openai" }]);

  // 第一跳交给百炼、润色交给 DeepSeek：要两家的 key，只差百炼的
  assert.deepEqual(
    ways.local.hops.map(({ role, platform }) => [role, platform]),
    [
      ["transcribe", "bailian"],
      ["polish", "deepseek"],
    ],
  );
  assert.equal(ways.local.hops[0].maker, "qwen");
  assert.deepEqual(ways.local.needs, [{ kind: "key", platform: "bailian" }]);

  // 数据隐私：不要 key，只看本机模型下载好了没有
  assert.deepEqual(
    ways.private.hops.map(({ role, platform }) => [role, platform]),
    [["transcribe", "local"]],
  );
  assert.deepEqual(ways.private.needs, [{ kind: "download", model: "sensevoice-small-q8" }]);
});

test("识别方式什么都不差时 needs 是空的；自定义服务没写地址也算差的", async () => {
  const ready = await view({ keys: { deepseek: "stored", gemini: "env" } });
  assert.deepEqual(ready.ways.local.needs, []);
  assert.deepEqual(ready.ways.private.needs, []);
  assert.deepEqual(ready.ways.native.needs, []);

  const custom = await view({ routes: routesWith({ polish: "custom/my-model" }), keys: { custom: "stored" } });
  assert.deepEqual(custom.ways.local.needs, [{ kind: "url" }]);
  assert.deepEqual(custom.ways.local.hops[1], { role: "polish", platform: "custom", maker: null, name: "my-model" });
});

test("某种方式的设置拼不出路线：照实交出原因，不编", async () => {
  const { ways } = await view({ routes: { ...routesWith({}), local: { problem: { key: "chat.modelRequired" } } } });
  assert.deepEqual(ways.local, { problem: { key: "chat.modelRequired" }, hops: [], needs: [] });
});

test("推荐组合：按推荐的先后列适合这台机器的，各写一路经过的模型、还差什么、每月多少钱；正在用的那个标出来", async () => {
  const current = { transcriber: "qwen3-asr-0.6b-q8", polish: "deepseek/deepseek-flash" };
  const { presets } = await view({
    mode: "local",
    routes: routesWith(current),
    presets: presetsWith(current, "apple-silicon"),
    keys: { deepseek: "stored" },
  });
  assert.deepEqual(
    presets.map(({ id }) => id),
    ["local-deepseek", "native-gemini", "bailian-cloud", "private-qwen"],
  );
  const [local, native, bailian, privately] = presets;

  assert.equal(local.active, true);
  assert.deepEqual(local.needs, []);
  assert.deepEqual(
    local.hops.map(({ role, platform }) => [role, platform]),
    [
      ["transcribe", "local"],
      ["polish", "deepseek"],
    ],
  );
  assert.ok(local.monthly.usd > 0);
  assert.equal(local.monthly.cny, local.monthly.usd * CNY_PER_USD);

  assert.equal(native.active, false);
  assert.deepEqual(native.needs, [{ kind: "key", platform: "gemini" }]);
  assert.deepEqual(native.settings, { model: "gemini/gemini-3.6-flash" });
  assert.deepEqual(bailian.needs, [{ kind: "key", platform: "bailian" }], "一把百炼的 key 管两跳");

  assert.equal(privately.monthly.usd, 0);
  assert.equal(privately.active, false, "数据隐私没在用");
});

test("推荐组合按芯片挑：Intel 的 Mac 上换成 CPU 版的本机模型", async () => {
  const { presets } = await view({ presets: presetsWith({}, "intel-mac") });
  assert.deepEqual(
    presets.map(({ id }) => id),
    ["native-gemini", "bailian-cloud", "local-deepseek-cpu", "private-sensevoice-cpu"],
  );
});
