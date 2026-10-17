// MiniMax 云端转写的价目表。照官方价目页 https://platform.minimax.cn/docs/pricing/overview 抄的（2026-10-16）：
//   - asr-1.0 按时长收，每小时 2.5 元；按回话里的 duration（秒）算
// 记账统一记美元，按 ../../../currency.mjs 换算。改价时照官方页改这里，并更新上面的日期。

import { cnyToUsd } from "../../../currency.mjs";

const SECONDS_PER_HOUR = 3_600;

/** 人民币每小时 */
export const PRICES = Object.freeze({ "asr-1.0": { hour: 2.5 } });

/**
 * 一次花了多少美元；价目里没有的型号、回话没报时长的是 null
 * @param {{ seconds: number | undefined }} usage
 */
export function costOf(model, { seconds }) {
  const price = PRICES[model];
  if (!price || typeof seconds !== "number") return null;
  return cnyToUsd((seconds * price.hour) / SECONDS_PER_HOUR);
}

/**
 * 模型广场上标的价：转一小时音频多少钱，人民币
 * @returns {{ currency: "CNY", perHour: number, approx: boolean } | null}
 */
export function listPrice(model) {
  const price = PRICES[model];
  return price ? { currency: "CNY", perHour: price.hour, approx: false } : null;
}
