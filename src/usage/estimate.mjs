import { cloudTranscriberOf } from "../server/asr/cloud/vendors.mjs";

// 一种用法每月大概花多少（模型页推荐组合上的那个数）。口径统一：每天 100 次、一个月 30 天，
// 一次按"典型的一次口述"的用量算。用量是实测的平均，价不在这里：交给各家价目模块的 costOf（和记账同一套），
// 价目改了这里跟着变。

export const DAILY_DICTATIONS = 100;
export const MONTHLY_DICTATIONS = DAILY_DICTATIONS * 30;

/**
 * 典型的一次口述用多少。scripts/dev/measure-dictation.mjs 在评测语料的 97 条真实录音上量的平均（2026-10-17）：
 * 润色交给的是本机 Qwen3-ASR 0.6B Q8 转好的原文（有原文的 96 条），原生用 App 默认的思考档位
 * （96 条，另 1 条被 Gemini 以内容安全拦下、没算进来）。
 * 量过的家才算得出成本：推荐组合用到了没量过的家，测试会说（test/models/presets.test.mjs），用那个脚本量一下补上。
 */
export const TYPICAL = Object.freeze({
  /** 一次说多长，秒 */
  seconds: 26.3,
  /** 第一跳交给云端、按 token 收的（按时长收的只看 seconds）：百炼 2026-10-16 实测 55 秒中文口述输入 740、输出 94，按时长折 */
  transcribe: Object.freeze({ inputTokens: Math.round((26.3 * 740) / 55), outputTokens: Math.round((26.3 * 94) / 55) }),
  /** 润色一次，按家（命中缓存的多少各家不一样）。input 是没命中缓存的那部分，写法同 chat/prices 的 costOf */
  polish: Object.freeze({
    deepseek: Object.freeze({ input: 214, cached: 1443, output: 48 }),
    bailian: Object.freeze({ input: 136, cached: 1520, output: 48 }),
  }),
  /** 原生一次，按家，写法各照那一家价目模块的 costOf（providers/prices） */
  native: Object.freeze({
    gemini: Object.freeze({ text: 1415, audio: 666, cachedText: 0, cachedAudio: 0, output: 54 }),
  }),
});

/**
 * 估价用的时刻：那一天（UTC）上午 02:30，也就是北京时间 10:30，工作日的高峰（DeepSeek 分峰谷，口述多在上班时间）。
 * 周末挪到下周一。同一天里算出来的数不跟着钟点变
 * @param {Date} now
 */
export function estimateTime(now) {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 30));
  const day = at.getUTCDay();
  if (day === 6) at.setUTCDate(at.getUTCDate() + 2);
  if (day === 0) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

/**
 * 一次口述多少美元。本机的那一跳不花钱；算不出来（没量过那一家、价目里没有、自定义服务）是 null，不编
 * @param {object} route 一条路线（storage/settings.mjs 的 routeOf）
 * @param {(role: string, vendor: string, model: string, usage: object, at: Date) => number | null} costOf
 *   查价：哪个角色、哪一家、哪个型号、用了多少（app/model-plaza.mjs 的 loadPriceBook 给的）
 * @param {Date} at
 * @returns {number | null}
 */
export function costPerDictation(route, costOf, at) {
  if (route.mode === "private") return 0;
  if (route.mode === "native") {
    const usage = TYPICAL.native[route.model.provider];
    return usage ? costOf("native", route.model.provider, route.model.model, usage, at) : null;
  }
  const cloud = cloudTranscriberOf(route.transcriber);
  const transcribe = cloud
    ? costOf("transcribe", cloud.vendor, cloud.model, { seconds: TYPICAL.seconds, ...TYPICAL.transcribe }, at)
    : 0;
  const usage = TYPICAL.polish[route.polish.vendor];
  const polish = usage ? costOf("polish", route.polish.vendor, route.polish.model, usage, at) : null;
  return transcribe === null || polish === null ? null : transcribe + polish;
}

/** 每天 100 次、一个月 30 天，多少美元；算不出来是 null */
export function monthlyCost(route, costOf, at) {
  const once = costPerDictation(route, costOf, at);
  return once === null ? null : once * MONTHLY_DICTATIONS;
}
