// Gemini 的价目表和算钱的规矩。照官方价目表 https://ai.google.dev/gemini-api/docs/pricing 抄的（2026-10-14），
// 只抄标准档（Standard）的付费价：我们的请求不走 Batch、Flex、Priority。免费档里用是不花钱的，这里照样按付费价算，所以是估算。
// 规矩（都是价目表上写的）：
//   - 输入按类型分价：有的型号音频比文字贵（图片、视频和文字同价，我们不发），有的型号不分
//   - 输出连思考的 token 一起按输出价
//   - 命中隐式缓存的那部分输入按缓存价，同样分音频和文字
//   - Pro 按这一次的提示词长短分两档：超过 20 万 token，整次都按高的那档
//   - 有的型号某天起涨价：按调用那天（UTC）的价
// 价格的单位是美元每百万 token。改价时照官方页改这里，并更新上面的日期。

const PER_MILLION = 1_000_000;
/** Pro 的提示词超过这么多 token 就按高的那档 */
const LONG_PROMPT = 200_000;

/** 3.6 Flash 和 3.8 Flash 同价，2027-01-01 起翻倍。until 是新价开始的那天 */
const FLASH = [
  { until: "2027-01-01", input: 0.75, output: 3.75, cached: 0.075 },
  { input: 1.5, output: 7.5, cached: 0.15 },
];
const PRO_3_1 = [{ input: 2, output: 12, cached: 0.2, long: { input: 4, output: 18, cached: 0.4 } }];

/**
 * 型号 → 按日期排好的几段价。audio / cachedAudio 不写就是和文字同价。
 * 停用了、请求会被自动转给新型号的（官方弃用页写的）按转去的那个算：响应里报的就是转去的型号，这两行只是兜底。
 */
export const PRICES = Object.freeze({
  "gemini-4-argon": [
    { until: "2026-12-01", input: 2, output: 10, cached: 0.1 },
    { input: 4, output: 20, cached: 0.2 },
  ],
  "gemini-3.8-flash": FLASH,
  "gemini-3.7-flash": FLASH,
  "gemini-3.6-flash": FLASH,
  "gemini-3.5-flash": FLASH,
  "gemini-3.5-flash-lite": [{ input: 0.3, output: 2.5, cached: 0.03 }],
  "gemini-3.1-flash-lite": [{ input: 0.25, audio: 0.5, output: 1.5, cached: 0.025, cachedAudio: 0.05 }],
  "gemini-3.1-pro-preview": PRO_3_1,
  "gemini-3.1-pro-preview-customtools": PRO_3_1,
  "gemini-3-flash-preview": [{ input: 0.5, audio: 1, output: 3, cached: 0.05, cachedAudio: 0.1 }],
  "gemini-2.5-pro": [{ input: 1.25, output: 10, cached: 0.125, long: { input: 2.5, output: 15, cached: 0.25 } }],
  "gemini-2.5-flash": [{ input: 0.3, audio: 1, output: 2.5, cached: 0.03, cachedAudio: 0.1 }],
  "gemini-2.5-flash-lite": [{ input: 0.1, audio: 0.3, output: 0.4, cached: 0.01, cachedAudio: 0.03 }],
});

/**
 * 一次调用花了多少美元。价目表里没有这个型号时是 null。
 * @param {string} model 实际回话的型号（响应里的 modelVersion）
 * @param {{ text: number, audio: number, cachedText: number, cachedAudio: number, output: number }} tokens
 *   输入按类型分开，各自含命中缓存的那部分（cachedText、cachedAudio）；output 连思考的一起
 * @param {Date} at 什么时候调的
 * @returns {number | null}
 */
export function costOf(model, tokens, at) {
  const dated = PRICES[model];
  if (!dated) return null;
  const day = at.toISOString().slice(0, 10);
  let price = dated.find(({ until }) => until === undefined || day < until);
  if (price.long && tokens.text + tokens.audio > LONG_PROMPT) price = price.long;
  const audio = price.audio ?? price.input;
  const cachedAudio = price.cachedAudio ?? price.cached;
  return (
    ((tokens.text - tokens.cachedText) * price.input +
      tokens.cachedText * price.cached +
      (tokens.audio - tokens.cachedAudio) * audio +
      tokens.cachedAudio * cachedAudio +
      tokens.output * price.output) /
    PER_MILLION
  );
}
