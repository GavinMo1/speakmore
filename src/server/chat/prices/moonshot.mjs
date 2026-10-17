// Kimi（月之暗面）官方开放平台国内站的价目表和算钱的规矩。照官方价目页 https://platform.kimi.com/docs/pricing/chat 抄的（2026-10-16）。
// 规矩（都是价目页上写的）：
//   - 价格的单位是人民币每百万 token，输入分命中缓存和未命中两个价，输出一个价；思考的 token 算在输出里
//   - 记账统一记美元（usage 的 costUsd），按 CNY_PER_USD 换算，见 ../../currency.mjs
// 改价时照官方页改这里，并更新上面的日期。

import { cnyToUsd } from "../../currency.mjs";

const PER_MILLION = 1_000_000;

export const PRICES = Object.freeze({
  "kimi-k2.6": { input: 6.5, cached: 1.1, output: 27 },
});

/**
 * 模型广场上标的价：输入（未命中缓存）和输出，人民币每百万 token。价目表里没有是 null
 * @returns {{ currency: "CNY", input: number, output: number } | null}
 */
export function listPrice(model) {
  const price = PRICES[model];
  return price ? { currency: "CNY", input: price.input, output: price.output } : null;
}

/**
 * 一次调用花了多少美元。价目表里没有这个型号时是 null。
 * @param {{ input: number, cached: number, output: number }} tokens input 是没命中缓存的那部分
 */
export function costOf(model, tokens) {
  const price = PRICES[model];
  if (!price) return null;
  const cny = (tokens.input * price.input + tokens.cached * price.cached + tokens.output * price.output) / PER_MILLION;
  return cnyToUsd(cny);
}
