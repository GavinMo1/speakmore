import { msg } from "../../i18n/index.mjs";
import { measuredText, tagTexts } from "../../models/describe.mjs";
import { findChatVendor } from "../../server/chat/vendors.mjs";
import { findProvider } from "../../server/providers/index.mjs";
import { displayWidth, INDENT, padEnd, paint } from "./text.mjs";

// 识别模式（speakmore mode），和 local 模式的两跳（speakmore transcriber、speakmore polish）。
// native 的模型照旧在 models.mjs（speakmore model）。

/** "DeepSeek 的 deepseek-flash"；自定义服务写它的主机名："127.0.0.1:11434 的 qwen3:8b"。一句 msg */
export function polishTitle({ vendor, model }, customUrl) {
  const name = vendor === "custom" && customUrl ? new URL(customUrl).host : findChatVendor(vendor).name;
  return msg("cli.model.describe", { provider: name, model });
}

/** 一条路线用的模型，写成一句话（msg）：native 是那一家的模型，local 是 第一跳 → 第二跳 */
export function routeTitle(route) {
  if (route.mode === "native") {
    return msg("cli.model.describe", { provider: findProvider(route.model.provider).name, model: route.model.model });
  }
  return msg("cli.modes.localRoute", {
    transcriber: route.transcriber,
    polish: polishTitle(route.polish, route.customUrl),
  });
}

/**
 * @param {object} view
 * @param {Record<string, object>} view.routes 每种模式按现在的设置走哪条路线
 * @param {string} view.current 现在是哪种模式
 * @param {{ color: boolean, t: Function }} options
 */
export function renderModes({ routes, current }, { color, t }) {
  const c = paint(color);
  const ids = Object.keys(routes);
  const idWidth = Math.max(...ids.map((id) => id.length)) + 3;
  const labelWidth = Math.max(...ids.map((id) => displayWidth(t(`modes.${id}`)))) + 3;
  const lines = [t("cli.modes.title"), ""];
  for (const id of ids) {
    const mark = id === current ? c.green("●") : " ";
    lines.push(
      `${INDENT}${mark} ${c.bold(padEnd(id, idWidth))}${padEnd(t(`modes.${id}`), labelWidth)}${t.text(routeTitle(routes[id]))}`,
    );
  }
  const other = ids.find((id) => id !== current);
  lines.push(
    "",
    `${INDENT}${t("cli.modes.switch", { mode: other })}`,
    `${INDENT}${t("cli.modes.nativeModels")}`,
    `${INDENT}${t("cli.modes.localHops")}`,
    `${INDENT}${t("cli.modes.withSettings")}`,
    "",
  );
  return lines.join("\n");
}

/** 不在 local 模式时：列出来看可以，开头说一句现在用不上 */
const notInLocal = (t, current) =>
  current === "local" ? [] : [`${INDENT}${t("cli.local.notInLocal", { current })}`, ""];

const megabytes = (bytes) => `${Math.round(bytes / 1_000_000)} MB`;

/**
 * 第一跳：本机转写模型。每个模型下面两行灰字：标签，和在这类芯片上的实测
 * @param {object} view
 * @param {ReadonlyArray<{ id: string, name: string, bytes: number, installed: boolean, tags: readonly string[], measured: readonly object[] }>} view.models
 *   measured 是在这类芯片上的实测（models/catalog.mjs 的 measuredOn）
 * @param {string | null} view.chip 这台机器是哪类芯片
 * @param {string} view.setting 设置里选的那个
 * @param {string} view.source 设置里的下载源
 * @param {readonly string[]} view.sources 能选的下载源
 * @param {string} view.current 现在是哪种模式
 * @param {{ color: boolean, t: Function }} options
 */
export function renderTranscribers({ models, chip, setting, source, sources, current }, { color, t }) {
  const c = paint(color);
  const idWidth = Math.max(...models.map(({ id }) => id.length)) + 3;
  const nameWidth = Math.max(...models.map(({ name }) => displayWidth(name))) + 3;
  const sizeWidth = Math.max(...models.map(({ bytes }) => megabytes(bytes).length)) + 3;
  const lines = [t("cli.local.transcribersTitle"), "", ...notInLocal(t, current)];
  for (const model of models) {
    const mark = model.id === setting ? c.green("●") : " ";
    const state = model.installed ? t("cli.local.installed") : c.dim(t("cli.local.notInstalled"));
    lines.push(
      `${INDENT}${mark} ${c.bold(padEnd(model.id, idWidth))}${padEnd(model.name, nameWidth)}${padEnd(megabytes(model.bytes), sizeWidth)}${state}`,
    );
    const under = `${INDENT}  ${" ".repeat(idWidth)}`;
    lines.push(c.dim(`${under}${tagTexts(model.tags).map(t.text).join(" · ")}`));
    lines.push(c.dim(`${under}${t.text(measuredText(model.measured, chip))}`));
  }
  const other = models.find(({ id }) => id !== setting) ?? models[0];
  const otherSource = sources.find((id) => id !== source);
  lines.push(
    "",
    `${INDENT}${t("cli.local.transcriberCurrent", { model: setting })}`,
    `${INDENT}${t("cli.local.transcriberSwitch", { id: other.id })}`,
    `${INDENT}${t("cli.local.sourceCurrent", { source: t(`modelSources.${source}`) })}`,
    `${INDENT}${t("cli.local.sourceSwitch", { other: otherSource })}`,
    "",
  );
  return lines.join("\n");
}

/** 一家的 key 在哪，写成什么 */
const keyText = (t, vendor, where) => {
  if (where === "stored") return t("cli.models.keyStored");
  if (where === "env") return t("cli.models.keyEnv", { variable: vendor.keyEnv });
  return t("cli.models.noKey");
};

/**
 * 第二跳：润色的那几家
 * @param {object} view
 * @param {ReadonlyArray<{ id: string, name: string, keyEnv: string, defaultModel: string | null, models: readonly string[] }>} view.vendors
 * @param {{ vendor: string, model: string }} view.polish 设置里选的那个
 * @param {string} view.customUrl 设置里的自定义地址（没填是空的）
 * @param {Record<string, "stored" | "env" | null>} view.keys
 * @param {string} view.current 现在是哪种模式
 * @param {{ color: boolean, t: Function }} options
 */
export function renderPolish({ vendors, polish, customUrl, keys, current }, { color, t }) {
  const c = paint(color);
  const nameOf = (vendor) => (vendor.id === "custom" ? t("cli.local.customName") : vendor.name);
  const modelOf = (vendor) => {
    if (vendor.id === polish.vendor) return polish.model;
    return vendor.defaultModel ? t("cli.models.default", { model: vendor.defaultModel }) : t("cli.local.customModel");
  };
  const idWidth = Math.max(...vendors.map(({ id }) => id.length)) + 3;
  const nameWidth = Math.max(...vendors.map((vendor) => displayWidth(nameOf(vendor)))) + 3;
  const modelWidth = Math.max(...vendors.map((vendor) => displayWidth(modelOf(vendor)))) + 3;
  const lines = [t("cli.local.polishTitle"), "", ...notInLocal(t, current)];
  for (const vendor of vendors) {
    const mark = vendor.id === polish.vendor ? c.green("●") : " ";
    const key = keyText(t, vendor, keys[vendor.id]);
    lines.push(
      `${INDENT}${mark} ${c.bold(padEnd(vendor.id, idWidth))}${padEnd(nameOf(vendor), nameWidth)}${padEnd(modelOf(vendor), modelWidth)}${keys[vendor.id] ? key : c.dim(key)}`,
    );
    // 能挑的别的模型列在下面一行
    const others = vendor.models.filter((model) => model !== modelOf(vendor) && model !== vendor.defaultModel);
    const listed = vendor.id === polish.vendor ? vendor.models.filter((model) => model !== polish.model) : others;
    if (listed.length > 0) {
      lines.push(
        c.dim(
          `${INDENT}  ${" ".repeat(idWidth + nameWidth)}${t("cli.local.alsoModels", { models: listed.join(" / ") })}`,
        ),
      );
    }
  }
  const url = polish.vendor === "custom" && customUrl ? customUrl : null;
  lines.push(
    "",
    `${INDENT}${t("cli.local.polishCurrent", { model: t.text(polishTitle(polish, url)) })}`,
    `${INDENT}${t("cli.local.polishSwitch")}`,
    `${INDENT}${t("cli.local.polishCustom")}`,
    `${INDENT}${t("cli.local.polishCheck")}`,
    "",
  );
  return lines.join("\n");
}
