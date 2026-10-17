// 智谱云端转写的价目表。照官方价目页 https://docs.bigmodel.cn/cn/guide/start/pricing 抄的（2026-10-16）：
//   - GLM-ASR-2512 按输入 token 收，每百万 16 元，价目页折成每秒约 0.0002 元；输出不收钱
//   - 回话不报用量，所以记账按录音时长折，是个约数
// 记账统一记美元，按 ../../../currency.mjs 换算。改价时照官方页改这里，并更新上面的日期。

import { cnyToUsd } from "../../../currency.mjs";

/** 人民币每秒（价目页折的约数） */
export const PRICES = Object.freeze({ "glm-asr-2512": { second: 0.0002 } });

/**
 * 一次花了多少美元；价目里没有的型号是 null
 * @param {{ seconds: number }} usage
 */
export function costOf(model, { seconds }) {
  const price = PRICES[model];
  return price ? cnyToUsd(seconds * price.second) : null;
}

/**
 * 模型广场上标的价：转一小时音频多少钱，人民币。按 token 收、价目页折的每秒价，所以是约数
 * @returns {{ currency: "CNY", perHour: number, approx: boolean } | null}
 */
export function listPrice(model) {
  const price = PRICES[model];
  return price ? { currency: "CNY", perHour: Math.round(price.second * 3600 * 100) / 100, approx: true } : null;
}
