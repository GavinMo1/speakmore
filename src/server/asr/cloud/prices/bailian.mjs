// 阿里云百炼云端转写的价目表。照百炼模型广场抄的（2026-10-16，用百炼命令行 bl model list --model <型号> 取）：
//   - 按时长的：每秒 0.00022 元（qwen3-asr-flash、qwen-audio-3.0-asr-flash、fun-asr-flash）
//   - qwen-audio-3.1-asr-flash 按 token：输入 0.8、输出 2.7 元每百万
// 记账统一记美元，按 ../../../currency.mjs 换算。改价时照控制台改这里，并更新上面的日期。

import { cnyToUsd } from "../../../currency.mjs";

const PER_MILLION = 1_000_000;
const SECOND = 0.00022;

export const PRICES = Object.freeze({
  "qwen3-asr-flash": { second: SECOND },
  "qwen-audio-3.0-asr-flash": { second: SECOND },
  "fun-asr-flash-2026-06-15": { second: SECOND },
  "qwen-audio-3.1-asr-flash": { input: 0.8, output: 2.7 },
});

/**
 * 按 token 收的型号一小时音频大约多少 token：2026-10-16 一段 55 秒的中文口述实测输入 740、输出 94。
 * 只用来在模型广场上折一个每小时的约数，记账按回话报的 token 算
 */
const TOKENS_PER_SECOND = { input: 740 / 55, output: 94 / 55 };

/**
 * 一次花了多少美元；价目里没有的型号是 null
 * @param {{ seconds: number, inputTokens: number, outputTokens: number }} usage
 */
export function costOf(model, { seconds, inputTokens, outputTokens }) {
  const price = PRICES[model];
  if (!price) return null;
  const cny = price.second
    ? seconds * price.second
    : (inputTokens * price.input + outputTokens * price.output) / PER_MILLION;
  return cnyToUsd(cny);
}

/**
 * 模型广场上标的价：转一小时音频多少钱，人民币。按 token 收的是按实测折的约数（approx）。价目里没有是 null
 * @returns {{ currency: "CNY", perHour: number, approx: boolean } | null}
 */
export function listPrice(model) {
  const price = PRICES[model];
  if (!price) return null;
  if (price.second) return { currency: "CNY", perHour: Math.round(price.second * 3600 * 100) / 100, approx: false };
  const perHour =
    (TOKENS_PER_SECOND.input * 3600 * price.input + TOKENS_PER_SECOND.output * 3600 * price.output) / PER_MILLION;
  return { currency: "CNY", perHour: Math.round(perHour * 100) / 100, approx: true };
}
