// 阿里云百炼上原生链路用的 Omni 系列的价目表。照百炼模型广场的价目抄的（2026-10-16，用百炼命令行
// bl model list --model <型号> 取）。规矩：
//   - 人民币每百万 token。输入分音频和文字两个价，输出只算文字（我们只要文字，不出语音）
//   - qwen3.8-omni-flash 的价目只写了一个输入价、一个输出价，音频文字同价
//   - qwen3-omni-flash 的文字输出分"输入只有文字"和"输入含音频"两个价，听写的输入总含音频，取后者
//   - 记账统一记美元，按 ../../currency.mjs 的汇率换算
// 改价时照控制台改这里，并更新上面的日期。

import { cnyToUsd } from "../../currency.mjs";

const PER_MILLION = 1_000_000;

export const PRICES = Object.freeze({
  "qwen3.8-omni-flash": { text: 0.8, audio: 0.8, output: 2.7 },
  "qwen3.5-omni-plus": { text: 7, audio: 53, output: 40 },
  "qwen3.5-omni-flash": { text: 2.2, audio: 18, output: 13.3 },
  "qwen3-omni-flash": { text: 1.8, audio: 15.8, output: 12.7 },
});

/** 带日期的快照（qwen3.5-omni-flash-2026-03-15）按型号查价 */
const SNAPSHOT = /-\d{4}-\d{2}-\d{2}$/;

/**
 * 一次调用花了多少美元。价目表里没有这个型号时是 null。
 * @param {{ text: number, audio: number, output: number }} tokens
 */
export function costOf(model, tokens) {
  const price = PRICES[model] ?? PRICES[model.replace(SNAPSHOT, "")];
  if (!price) return null;
  return cnyToUsd((tokens.text * price.text + tokens.audio * price.audio + tokens.output * price.output) / PER_MILLION);
}
