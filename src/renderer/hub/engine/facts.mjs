import { h } from "../../shared/dom.mjs";
import { t } from "../../shared/i18n.mjs";

// 详情里的数：名目在上、数在下。语音那一段的详情（detail.mjs）和划词那一段的详情（lookup.mjs）都用。

const money = (currency) => (currency === "CNY" ? "¥" : "$");
/** 价保留到分：两位小数以内 */
const amount = (value) => String(Math.round(value * 100) / 100);

/** 一项数：名目在上、数在下；同组最佳的标绿（悬停时也说），评分底下一根条。口径在悬停里 */
export function fact({ label, tip, cur, value, unit, best = false, meter = null }) {
  return h(
    "div",
    { class: "fact", "data-best": best ? "" : null, title: best ? `${tip} · ${t("plaza.detail.best")}` : tip },
    h("dt", { class: "fact-label" }, best && h("i", { class: "best-dot" }), label),
    h(
      "dd",
      { class: "fact-value" },
      cur && h("span", { class: "fact-cur", text: cur }),
      h("span", { class: "fact-num", text: value }),
      unit && h("span", { class: "fact-unit", text: unit }),
    ),
    meter !== null && h("span", { class: "meter", style: `--v: ${meter}`, "aria-hidden": "true" }),
  );
}

/**
 * 云端模型在一个平台上的标价：按小时音频的一格，或者输入、输出两格；下面一行小字是谁家的标价
 * @param {object | null | undefined} price 货架上的（app/model-plaza.mjs）；拿不到是 null
 * @param {string} platform 平台名
 * @returns {{ facts: HTMLElement[], note: string | null }}
 */
export function priceFacts(price, platform) {
  if (!price) {
    return { facts: [fact({ label: t("plaza.detail.price"), tip: t("plaza.cols.noPrice"), value: "—" })], note: null };
  }
  if (typeof price.perHour === "number") {
    return {
      facts: [
        fact({
          label: t("plaza.cols.hour"),
          tip: t(price.approx ? "plaza.cols.hourApprox" : "plaza.cols.hourTip"),
          cur: `${price.approx ? "≈" : ""}${money(price.currency)}`,
          value: amount(price.perHour),
          unit: t("plaza.detail.perHour"),
        }),
      ],
      note: t("plaza.detail.listPrice", { platform }),
    };
  }
  const cur = money(price.currency);
  return {
    facts: [
      fact({ label: t("plaza.cols.input"), tip: t("plaza.cols.inputTip"), cur, value: amount(price.input) }),
      fact({ label: t("plaza.cols.output"), tip: t("plaza.cols.outputTip"), cur, value: amount(price.output) }),
    ],
    note: t("plaza.detail.listPriceTokens", { platform }),
  };
}
