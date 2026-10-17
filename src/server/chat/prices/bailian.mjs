// 阿里云百炼（国内站）上润色用的那几个模型的价目表和算钱的规矩。照百炼模型广场的价目抄的（2026-10-16，
// 用百炼命令行 bl model list --model <型号> 取，和控制台模型详情页一致）。
// 规矩：
//   - 价格的单位是人民币每百万 token，输入输出分开；命中缓存的输入另有价。这里只收标准时段、最低一档上下文的价：
//     润色一次的输入只有几百到几千 token，落不到更高的档
//   - DeepSeek 在百炼上分高峰和低谷（高峰 2 / 8，低谷 1 / 4），这里不知道百炼的高峰是哪几个小时，一律按高峰价算，宁可多算
//   - 记账统一记美元（usage 的 costUsd），按 CNY_PER_USD 换算，见 ../../currency.mjs
// 价目里没有的型号（比如 qwen3.7-plus，2026-10-16 百炼的价目接口没给它的价）花费记成空。改价时照控制台改这里，并更新上面的日期。

import { cnyToUsd } from "../../currency.mjs";

const PER_MILLION = 1_000_000;

export const PRICES = Object.freeze({
  "qwen3.8-max": { input: 12, cached: 1.5, output: 36 },
  "qwen3.8-flash": { input: 0.8, cached: 0.1, output: 2.7 },
  "qwen3.8-27b": { input: 3, cached: 0.6, output: 12 },
  "deepseek-v4.1-flash": { input: 2, cached: 0.2, output: 8 },
  "deepseek-v4-pro": { input: 12, cached: 1, output: 24 },
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
