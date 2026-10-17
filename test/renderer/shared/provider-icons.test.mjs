import assert from "node:assert/strict";
import { test } from "node:test";
import { MODELS, makerOf } from "../../../src/models/catalog.mjs";
import { PROVIDER_ICON_PATHS } from "../../../src/renderer/shared/provider-icons.mjs";
import { CHAT_VENDORS } from "../../../src/server/chat/vendors.mjs";
import { PROVIDERS } from "../../../src/server/providers/index.mjs";

const PATH = /^[Mm][\d.\s,a-zA-Z-]+z?$/;
/** 一条路径，或几层 { d, opacity, rule } */
const isIcon = (icon) =>
  typeof icon === "string"
    ? PATH.test(icon)
    : Array.isArray(icon) && icon.length > 0 && icon.every(({ d }) => PATH.test(d));

test("每一家模型都有图标：接了新的一家，设置和首次引导里不会只剩个名字", () => {
  for (const { id } of PROVIDERS) assert.ok(isIcon(PROVIDER_ICON_PATHS[id]), id);
});

test("润色的每一家也有图标，自定义服务用一个通用的", () => {
  for (const { id, models } of CHAT_VENDORS) {
    assert.ok(isIcon(PROVIDER_ICON_PATHS[id]), id);
    // 一个平台上有好几家的模型，按出自哪家配图标
    for (const { maker } of models) assert.ok(isIcon(PROVIDER_ICON_PATHS[maker]), `${id} 上的 ${maker}`);
  }
});

test("本机模型按出自哪家配图标：作者仓库的组织名", () => {
  assert.equal(makerOf(MODELS.find(({ id }) => id === "qwen3-asr-0.6b-q8")), "qwen");
  assert.equal(makerOf(MODELS.find(({ id }) => id === "sensevoice-small-q8")), "funaudiollm");
  for (const model of MODELS) assert.ok(isIcon(PROVIDER_ICON_PATHS[makerOf(model)]), model.id);
});
