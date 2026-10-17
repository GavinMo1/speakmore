import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPriceBook } from "../../src/app/model-plaza.mjs";
import { findLocale } from "../../src/i18n/index.mjs";
import { CHIPS, findModel } from "../../src/models/catalog.mjs";
import { PRESETS } from "../../src/models/presets.mjs";
import { CLOUD_TRANSCRIBERS, cloudTranscriberOf } from "../../src/server/asr/cloud/vendors.mjs";
import { CHAT_VENDORS } from "../../src/server/chat/vendors.mjs";
import { MODES } from "../../src/server/modes.mjs";
import { PROVIDERS } from "../../src/server/providers/index.mjs";
import { MODE_SETTINGS, patchSettings, resolveSettings, routeOf } from "../../src/storage/settings.mjs";
import { estimateTime, monthlyCost } from "../../src/usage/estimate.mjs";

// 推荐组合（src/models/presets.mjs）的规矩：加一个、删一个都只动那张表和两行文案，别的由这里查。
// 哪个组合引用的模型下架了、带了不属于那种方式的设置、算不出月成本、缺了文案，这里点名是哪一个。

const DEFAULT_SETTINGS = resolveSettings({ file: "/nonexistent/settings.json", env: {} });
const routeOfPreset = ({ mode, settings }) => routeOf(patchSettings(DEFAULT_SETTINGS, settings), mode);

/** 清单里有、而且拿真 key 调过（不是未验证）的那一项 */
function listed(registry, vendor, model) {
  return (
    registry.find(({ id }) => id === vendor)?.models.find((entry) => entry.id === model && !entry.unverified) ?? null
  );
}

test("id 不重复；方式是三种之一；带的设置都属于那种方式（模式切换只收这几项）", () => {
  assert.equal(new Set(PRESETS.map(({ id }) => id)).size, PRESETS.length);
  for (const preset of PRESETS) {
    assert.ok(
      MODES.some(({ id }) => id === preset.mode),
      `${preset.id}：不认识的方式 ${preset.mode}`,
    );
    for (const name of Object.keys(preset.settings)) {
      assert.ok(MODE_SETTINGS[preset.mode].includes(name), `${preset.id}：${name} 不属于 ${preset.mode}`);
    }
  }
});

test("引用的模型都在清单里、拿真 key 调过；芯片写的是认识的那几类", () => {
  for (const preset of PRESETS) {
    const route = routeOfPreset(preset);
    if (route.mode === "native") {
      assert.ok(listed(PROVIDERS, route.model.provider, route.model.model), `${preset.id}：原生模型不在清单里`);
    } else {
      const cloud = cloudTranscriberOf(route.transcriber);
      assert.ok(
        cloud ? listed(CLOUD_TRANSCRIBERS, cloud.vendor, cloud.model) : findModel(route.transcriber),
        `${preset.id}：转写模型 ${route.transcriber} 不在清单里`,
      );
      if (route.mode === "local") {
        assert.ok(
          listed(CHAT_VENDORS, route.polish.vendor, route.polish.model),
          `${preset.id}：润色模型不在清单里（自定义服务不能做推荐组合）`,
        );
      }
    }
    for (const chip of preset.chips ?? []) {
      assert.ok(
        CHIPS.some(({ id }) => id === chip),
        `${preset.id}：不认识的芯片 ${chip}`,
      );
    }
  }
});

test("每个组合都算得出每月多少钱（没量过的家要先用 scripts/dev/measure-dictation.mjs 量一下）", async () => {
  const { costOf } = await loadPriceBook();
  const at = estimateTime(new Date("2026-10-19T00:00:00Z"));
  for (const preset of PRESETS) {
    const cost = monthlyCost(routeOfPreset(preset), costOf, at);
    assert.ok(cost !== null && cost >= 0, `${preset.id}：算不出月成本`);
  }
});

test("文案中英都有名字和说明，没有删了组合还留着的文案", () => {
  const ids = PRESETS.map(({ id }) => id).sort();
  for (const locale of ["zh-CN", "en"]) {
    const texts = findLocale(locale).messages.presets?.items ?? {};
    for (const id of ids) {
      assert.equal(typeof texts[id]?.name, "string", `${locale} 少了 presets.${id}.name`);
      assert.equal(typeof texts[id]?.desc, "string", `${locale} 少了 presets.${id}.desc`);
    }
    const extra = Object.keys(texts).filter((key) => !ids.includes(key));
    assert.deepEqual(extra, [], `${locale} 里多出来的组合文案`);
  }
});
