// MiniMax 开放平台（国内站）上润色用的模型的价目表和算钱的规矩。照官方价目页 https://platform.minimax.cn/docs/pricing/overview
// 抄的（2026-10-16）。规矩：
//   - 价格的单位是人民币每百万 token，输入、输出、缓存读取各一个价。M3 标着"永久五折"，这里记折后的价
//   - 只收标准服务、输入不超过 512k 的那一档：润色不开优先服务（service_tier），一次的输入也只有几百到几千 token
//   - 记账统一记美元（usage 的 costUsd），按 CNY_PER_USD 换算，见 ../../currency.mjs
// 改价时照官方页改这里，并更新上面的日期。

import { cnyToUsd } from "../../currency.mjs";

const PER_MILLION = 1_000_000;

export const PRICES = Object.freeze({
  "MiniMax-M3": { input: 2.1, cached: 0.42, output: 8.4 },
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
