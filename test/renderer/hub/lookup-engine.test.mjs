import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, describePlaza, loadPriceBook } from "../../../src/app/model-plaza.mjs";
import { lookupView } from "../../../src/renderer/hub/engine/lookup-view.mjs";

// 引擎页"划词"那一段里机器查得了的部分：哪一项在用、看哪个渠道、还差什么。画在页面上的样子在真窗口里看。

const prices = await loadPriceBook();

/** 一份 getSetup 的样子，只放划词那一段要的：广场（货架、密钥表）和划词自己的几项 */
function setupWith({ lookup = {}, keys = { deepseek: "stored" } } = {}) {
  const plaza = describePlaza({
    mode: "local",
    chosen: { native: DEFAULTS.native, transcriber: DEFAULTS.transcribe, polish: DEFAULTS.polish, customUrl: "" },
    keys,
    status: {},
    chip: "apple-silicon",
    freeBytes: 1e11,
    prices,
    routes: {},
    presets: [],
    at: new Date("2026-10-22T02:30:00Z"),
  });
  return {
    plaza,
    lookup: {
      to: "zh-CN",
      model: "deepseek/deepseek-flash",
      customUrl: "",
      customParams: "",
      customKey: null,
      ...lookup,
    },
  };
}

const groupOf = (setup, id) => setup.plaza.shelves.lookup.find((group) => group.id === id);
const itemNamed = (group, name) => group.items.find((item) => item.name === name);

test("在用的那一项：清单里的按设置里存的 厂商/模型 认（哪个渠道上的都算），选定的那一家先展开", () => {
  const setup = setupWith({ lookup: { model: "bailian/deepseek-v4.1-flash" } });
  const view = lookupView(setup);
  const deepseek = groupOf(setup, "deepseek");
  const flash = itemNamed(deepseek, "DeepSeek V4.1 Flash");
  assert.equal(view.holds(deepseek, flash), true);
  assert.equal(view.holds(deepseek, itemNamed(deepseek, "DeepSeek V4 Pro")), false);
  assert.equal(view.groupHolds(deepseek), true);
  assert.deepEqual(view.chosenSpot(), { group: deepseek, item: flash });
  // 在百炼上选的：看的渠道是百炼，详情里算已经选定；换到官方看就要再启用一次
  assert.equal(view.viaOf(deepseek), "bailian");
  assert.equal(view.isChosen(deepseek, flash), true);
  const official = lookupView(setup, { via: { deepseek: "deepseek" } });
  assert.equal(official.choiceOf(deepseek, flash), "deepseek/deepseek-flash");
  assert.equal(official.isChosen(deepseek, flash), false);
});

test("渠道：选过的 → 正在用的 → 配了密钥的 → 第一个", () => {
  const setup = setupWith({ lookup: { model: "zhipu/glm-4.5-air" }, keys: { bailian: "stored" } });
  const deepseek = groupOf(setup, "deepseek");
  assert.equal(lookupView(setup).viaOf(deepseek), "bailian");
  assert.equal(lookupView(setupWith({ keys: {} })).viaOf(deepseek), "deepseek");
});

test("一项还差什么：看的渠道没密钥、这个渠道不卖它、自定义服务没配齐；都不差是 null", () => {
  const setup = setupWith({ keys: { deepseek: "stored" } });
  const view = lookupView(setup);
  const deepseek = groupOf(setup, "deepseek");
  assert.equal(view.blocker(deepseek, deepseek.items[0]), null);
  assert.equal(view.groupBlocker(deepseek), null);
  const kimi = groupOf(setup, "kimi");
  assert.equal(view.blocker(kimi, kimi.items[0]), "key");
  assert.equal(view.groupBlocker(kimi), "key");
  // 通义的模型只有百炼卖：在百炼上看、没密钥是 key
  const qwen = groupOf(setup, "qwen");
  assert.equal(view.blocker(qwen, qwen.items[0]), "key");
  const custom = groupOf(setup, "custom");
  assert.equal(view.blocker(custom, custom.items[0]), "custom");
  assert.equal(view.groupBlocker(custom), "custom");
  // 有地址没 key、有 key 没地址都不算配齐
  const halfway = setupWith({ lookup: { customUrl: "http://127.0.0.1:11434/v1" } });
  assert.equal(lookupView(halfway).groupBlocker(groupOf(halfway, "custom")), "custom");
  const ready = setupWith({ lookup: { customUrl: "http://127.0.0.1:11434/v1", customKey: "stored" } });
  assert.equal(lookupView(ready).groupBlocker(groupOf(ready, "custom")), null);
});

test("这个渠道不卖这一项：channel", () => {
  const setup = setupWith({ keys: { deepseek: "stored", bailian: "stored" } });
  const view = lookupView(setup, { via: { qwen: "deepseek" } });
  const qwen = groupOf(setup, "qwen");
  assert.equal(view.blocker(qwen, qwen.items[0]), "channel");
});

test("自定义服务：在用时模型名取设置里的，地址、参数是划词自己的；没在用时模型名空着", () => {
  const using = setupWith({
    lookup: {
      model: "custom/qwen3:8b",
      customUrl: "http://127.0.0.1:11434/v1",
      customParams: '{"keep_alive":"5m"}',
      customKey: "stored",
    },
  });
  const view = lookupView(using);
  const custom = groupOf(using, "custom");
  assert.equal(view.holds(custom, custom.items[0]), true);
  assert.deepEqual(view.customNow(), {
    model: "qwen3:8b",
    url: "http://127.0.0.1:11434/v1",
    params: '{"keep_alive":"5m"}',
  });
  assert.equal(view.chosenSpot().group.id, "custom");
  const notUsing = lookupView(setupWith({ lookup: { customUrl: "http://127.0.0.1:11434/v1" } }));
  assert.equal(notUsing.customNow().model, "");
  assert.equal(notUsing.holds(custom, custom.items[0]), false);
});
