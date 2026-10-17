import { DEFAULT_TRANSCRIBER, downloadSize, MODELS, makerOf, measuredOn } from "../models/catalog.mjs";
import { nameParts } from "../models/describe.mjs";
import { CLOUD_TRANSCRIBERS } from "../server/asr/cloud/vendors.mjs";
import { CHAT_VENDORS, formatChatChoice, parseChatChoice } from "../server/chat/vendors.mjs";
import { DEFAULT_POLISH } from "../server/modes.mjs";
import { DEFAULT_MODEL_CHOICE, formatModelChoice, PROVIDERS } from "../server/providers/index.mjs";
import { VENDORS } from "../server/vendors.mjs";

// 模型广场（主窗口侧栏的"模型"一页）要的数据。按角色分三排货架，加一张密钥表：
//   native      原生识别：收音频的模型（server/providers）
//   transcribe  转写：本机模型（models/catalog.mjs）和云端模型（server/asr/cloud）
//   polish      润色：纯文字模型（server/chat/vendors.mjs），最后是自定义服务
// 云端的货架按"谁做的"（maker）分组，一组里的模型可能有好几个平台卖（DeepSeek 官方和百炼都有 V4.1 Flash）：
// 平台是这一组的渠道，同一个模型在各渠道的写法和价格各自记在 offers 里。用户一个平台只配一把 key。
// 模型信息只从各个登记处读，这里不另写；会变的（设置、key 在哪、本机模型的下载状态、价）由调用方给。

/** 平台在密钥表里的先后：覆盖最广的在前，自定义服务总在最后，没列到的排在它们中间 */
const PLATFORM_ORDER = ["bailian", "deepseek", "moonshot", "zhipu", "minimax", "gemini", "openai"];
/** 货架上各组的先后（按 maker），没列到的接在后面 */
const MAKER_ORDER = ["qwen", "deepseek", "kimi", "zhipu", "minimax", "gemini", "openai"];

const rank = (order, id) => {
  const at = order.indexOf(id);
  return at === -1 ? order.length : at;
};

/**
 * 三个角色在各平台上的清单：[{ vendor, models }]。润色那边的自定义服务单独成一组（没有清单可列）
 * @type {Record<"native" | "transcribe" | "polish", ReadonlyArray<{ id: string, models: ReadonlyArray<object> }>>}
 */
const REGISTRIES = {
  native: PROVIDERS,
  transcribe: CLOUD_TRANSCRIBERS,
  polish: CHAT_VENDORS.filter(({ id }) => id !== "custom"),
};

/** 各角色的出厂默认，写法同设置（厂商/模型；本机模型是 id） */
export const DEFAULTS = Object.freeze({
  native: formatModelChoice(DEFAULT_MODEL_CHOICE),
  transcribe: DEFAULT_TRANSCRIBER,
  polish: formatChatChoice(parseChatChoice(DEFAULT_POLISH)),
});

/**
 * 把三个角色要标价的那几家的价目模块都加载好，交回一个查价的函数（主进程启动时调一次）
 * @returns {Promise<(role: string, vendor: string, model: string) => object | null>}
 */
export async function loadPriceBook() {
  const book = {};
  for (const [role, registry] of Object.entries(REGISTRIES)) {
    book[role] = {};
    for (const vendor of registry) {
      if (vendor.prices) book[role][vendor.id] = (await vendor.prices()).listPrice ?? null;
    }
  }
  return (role, vendor, model) => book[role]?.[vendor]?.(model) ?? null;
}

/** 云端的一排货架：按 maker 分组，同名的模型并成一行，各平台是这一行的渠道 */
function cloudShelf(role, priceOf) {
  const groups = new Map();
  for (const vendor of REGISTRIES[role]) {
    for (const model of vendor.models) {
      if (!groups.has(model.maker))
        groups.set(model.maker, { id: model.maker, kind: "cloud", channels: [], rows: new Map() });
      const group = groups.get(model.maker);
      if (!group.channels.includes(vendor.id)) group.channels.push(vendor.id);
      if (!group.rows.has(model.name))
        group.rows.set(model.name, { name: model.name, tested: false, issue: null, offers: {} });
      const row = group.rows.get(model.name);
      row.tested ||= Boolean(model.tested);
      row.issue ??= model.issue ?? null;
      // 未验证（照文档接入、没拿真 key 调过）跟着渠道走：同一个模型换一家卖，可能就验过了
      row.offers[vendor.id] = {
        choice: `${vendor.id}/${model.id}`,
        price: priceOf(role, vendor.id, model.id),
        unverified: Boolean(model.unverified),
      };
    }
  }
  return [...groups.values()]
    .sort((a, b) => rank(MAKER_ORDER, a.id) - rank(MAKER_ORDER, b.id))
    .map(({ rows, ...group }) => ({
      ...group,
      items: [...rows.values()].map(({ tested, issue, ...row }) => ({
        ...row,
        tags: tagsOf({
          isDefault: Object.values(row.offers).some(({ choice }) => choice === DEFAULTS[role]),
          tested,
          issue,
        }),
      })),
    }));
}

/** 标签只有三种：出厂默认、跑过成批评测、已知问题（文案 models.issues.<issue>） */
function tagsOf({ isDefault, tested, issue }) {
  return [
    ...(isDefault ? [{ kind: "default" }] : []),
    ...(tested ? [{ kind: "tested" }] : []),
    ...(issue ? [{ kind: "issue", issue }] : []),
  ];
}

/**
 * 本机模型那一组：名字拆成型号和量化档，规格取这类芯片上跑得最快的那次实测
 * @param {Record<string, object>} status models/library.mjs 的 status，按 id
 */
function localGroup({ status, chip, freeBytes }) {
  return {
    id: "local",
    kind: "local",
    channels: ["local"],
    freeBytes,
    chip,
    items: MODELS.map((model) => {
      const [best] = measuredOn(model, chip);
      const { base, variant } = nameParts(model.name);
      return {
        name: base,
        variant,
        maker: makerOf(model),
        choice: model.id,
        backend: best?.backend ?? null,
        bytes: downloadSize(model),
        license: model.license.name,
        ...(status[model.id] ?? { installed: false, download: null, partial: 0, problem: null }),
        specs: best
          ? {
              zh: best.zh ?? null,
              mix: best.mix ?? null,
              minuteSeconds: 60 / best.realtime,
              memoryGB: best.peakMB / 1000,
              sizeMB: downloadSize(model) / 1_000_000,
            }
          : null,
        tags: tagsOf({ isDefault: model.id === DEFAULTS.transcribe, tested: false, issue: null }),
      };
    }),
  };
}

/** 一个平台在三排货架上各有几个模型（密钥表里写"可用 原生 4 · 转写 4 · 润色 7"） */
function coverageOf(id) {
  return Object.fromEntries(
    Object.entries(REGISTRIES).map(([role, registry]) => [
      role,
      registry.find((vendor) => vendor.id === id)?.models.length ?? 0,
    ]),
  );
}

/**
 * @param {object} options
 * @param {"native" | "local" | "private"} options.mode 正在用哪种识别方式
 * @param {{ native: string, transcriber: string, privateTranscriber: string, polish: string, customUrl: string }} options.chosen
 *   设置里各角色选的（转写在 local、private 两种方式里各选各的）
 * @param {Record<string, "env" | "stored" | null>} options.keys 每家的 key 在哪（key-manager 的 sources）
 * @param {Record<string, object>} options.status 本机模型的状态，按 id（models/library.mjs 的 status）
 * @param {string | null} options.chip catalog.mjs 的 chipOf
 * @param {number | null} options.freeBytes 模型目录那块磁盘还剩多少；查不了是 null
 * @param {(role: string, vendor: string, model: string) => object | null} options.priceOf loadPriceBook 给的
 */
export function describePlaza({ mode, chosen, keys, status, chip, freeBytes, priceOf }) {
  const platforms = VENDORS.map(({ id, name, keyEnv, keyPage }) => ({
    id,
    name,
    keyEnv,
    hasKeyPage: Boolean(keyPage),
    key: keys[id] ?? null,
    coverage: coverageOf(id),
  })).sort((a, b) => {
    if (a.id === "custom" || b.id === "custom") return a.id === "custom" ? 1 : -1;
    return rank(PLATFORM_ORDER, a.id) - rank(PLATFORM_ORDER, b.id);
  });
  return {
    mode,
    chosen,
    defaults: DEFAULTS,
    platforms,
    shelves: {
      native: cloudShelf("native", priceOf),
      transcribe: [localGroup({ status, chip, freeBytes }), ...cloudShelf("transcribe", priceOf)],
      polish: [
        ...cloudShelf("polish", priceOf),
        { id: "custom", kind: "custom", channels: ["custom"], items: [{ name: null, tags: [], offers: {} }] },
      ],
    },
  };
}
