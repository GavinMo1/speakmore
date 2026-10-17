// 智谱开放平台（国内站）上润色用的那几个模型的价目表和算钱的规矩。照官方价目页 https://docs.bigmodel.cn/cn/guide/start/pricing
// 抄的（2026-10-16）。规矩：
//   - 价格的单位是人民币每百万 token，输入分命中缓存和未命中两个价，输出一个价；缓存存储限时免费，不算
//   - 有的型号按输入、输出的长度分档。这里只收输入不到 32K 的那一档：润色一次的输入只有几百到几千 token，落不到更高的档
//   - GLM-4.5-Air 还按这一次输出的长度分两档：不到 0.2K（200 个 token）一个价，到了另一个价
//   - 记账统一记美元（usage 的 costUsd），按 CNY_PER_USD 换算，见 ../../currency.mjs
// 改价时照官方页改这里，并更新上面的日期。

import { cnyToUsd } from "../../currency.mjs";

const PER_MILLION = 1_000_000;
/** GLM-4.5-Air 输出分档的界线 */
const SHORT_OUTPUT = 200;

export const PRICES = Object.freeze({
  "glm-5.2": { input: 8, cached: 2, output: 28 },
  "glm-4.7-flashx": { input: 0.5, cached: 0.1, output: 3 },
  "glm-4.5-air": { input: 0.8, cached: 0.16, output: 2, longOutput: 6 },
});

/**
 * 模型广场上标的价：输入（未命中缓存）和输出，人民币每百万 token；分档的输出标短的那档（润色的成品多半不到 200 token）。价目表里没有是 null
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
  const output = price.longOutput !== undefined && tokens.output >= SHORT_OUTPUT ? price.longOutput : price.output;
  const cny = (tokens.input * price.input + tokens.cached * price.cached + tokens.output * output) / PER_MILLION;
  return cnyToUsd(cny);
}
