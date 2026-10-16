import { msg } from "../i18n/index.mjs";

// 把配置表（catalog.mjs）里的标签和实测数字写成话（msg），命令行和 App 的模型列表都用这一份，按界面语言翻。

/**
 * 转写进程报的后端名写成什么：运行库报的是设备名（transcribe.cpp 的 MTL0 是第一块 GPU 走 Metal），
 * 认得的按 localModels.backends 翻，不认得的照原样
 */
export function backendText(reported) {
  if (/^MTL/i.test(reported)) return msg("localModels.backends.metal");
  if (/^cpu/i.test(reported)) return msg("localModels.backends.cpu");
  return reported;
}

/** 多大，给人看：1 GB 以下按 MB，以上按 GB（十进制，和下载工具、访达一样） */
export function sizeText(bytes) {
  return bytes < 1_000_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/** 一个模型的标签，一个标签一句 */
export const tagTexts = (tags) => tags.map((tag) => msg(`localModels.tags.${tag}`));

/**
 * 在这台机器这类芯片上实测得怎样：挑跑得最快的那一条（catalog.mjs 的 measuredOn 排好了）。没测过也如实说
 * @param {ReadonlyArray<{ backend: string, score: number, realtime: number, peakMB: number }>} measured
 * @param {string | null} chip catalog.mjs 的 chipOf
 */
export function measuredText(measured, chip) {
  if (chip === null) return msg("localModels.unknownChip");
  const name = msg(`localModels.chips.${chip}`);
  if (measured.length === 0) return msg("localModels.notMeasured", { chip: name });
  const [best] = measured;
  return msg("localModels.measured", {
    chip: name,
    backend: msg(`localModels.backends.${best.backend}`),
    score: best.score.toFixed(2),
    realtime: String(Math.round(best.realtime)),
    memory: `${(best.peakMB / 1000).toFixed(1)} GB`,
  });
}

/**
 * 同一份实测拆开给 App 的模型列表：三个数各一格（数值、单位、名目），在什么机器上用什么跑的另一句。
 * 没测过、认不出芯片时没有数，那一句照 measuredText 说
 * @param {ReadonlyArray<{ backend: string, score: number, realtime: number, peakMB: number }>} measured
 * @param {string | null} chip
 * @returns {{ figures: Array<{ value: string, unit: string, label: object }>, where: object }}
 */
export function measuredFacts(measured, chip) {
  if (chip === null || measured.length === 0) return { figures: [], where: measuredText(measured, chip) };
  const [best] = measured;
  return {
    figures: [
      { value: best.score.toFixed(2), unit: "/5", label: msg("localModels.figures.score") },
      { value: String(Math.round(best.realtime)), unit: "×", label: msg("localModels.figures.speed") },
      { value: (best.peakMB / 1000).toFixed(1), unit: "GB", label: msg("localModels.figures.memory") },
    ],
    where: msg("localModels.measuredOn", {
      chip: msg(`localModels.chips.${chip}`),
      backend: msg(`localModels.backends.${best.backend}`),
    }),
  };
}

/** 型号的名字分成名字和括号里的量化档（"Qwen3-ASR 0.6B (Q8_0)" → Qwen3-ASR 0.6B、Q8_0），App 把量化档放进小标签 */
export function nameParts(name) {
  const match = /^(.+?)\s*\(([^()]+)\)$/.exec(name);
  return match ? { base: match[1], variant: match[2] } : { base: name, variant: null };
}
