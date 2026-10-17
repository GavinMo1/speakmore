import { loadPriceBook } from "../app/model-plaza.mjs";
import { PRESETS } from "../models/presets.mjs";
import { CNY_PER_USD } from "../server/currency.mjs";
import { patchSettings, resolveSettings, routeOf } from "../storage/settings.mjs";
import { estimateTime, monthlyCost } from "./estimate.mjs";

// 官网费用一段的两个方案每月多少（每天 100 次）：和模型页推荐组合同一套算法、同一份价目。
// 付费的是本机转写加 DeepSeek 润色（local-deepseek），免费的是纯本机（private-qwen）。
// 官网构建时拿不到 App 的依赖，所以先算好写进 website/src/costs.json（npm run plan-costs），测试守着两边对得上。

export const PLANS = Object.freeze({ paid: "local-deepseek", free: "private-qwen" });

/**
 * @param {Date} now 按哪一天的价（estimateTime 取那天北京时间上午 10:30，工作日高峰）
 * @returns {Promise<Record<"paid" | "free", { usd: number, cny: number }>>} 都到分
 */
export async function planCosts(now = new Date()) {
  const { costOf } = await loadPriceBook();
  // 没有设置文件：都按默认的算，推荐组合再换上它自己那几项
  const defaults = resolveSettings({ file: "/nonexistent/settings.json", env: {} });
  const at = estimateTime(now);
  const cents = (value) => Math.round(value * 100) / 100;
  const entries = Object.entries(PLANS).map(([plan, id]) => {
    const preset = PRESETS.find((item) => item.id === id);
    if (!preset) throw new Error(`没有推荐组合 ${id}（src/models/presets.mjs）`);
    const usd = monthlyCost(routeOf(patchSettings(defaults, preset.settings), preset.mode), costOf, at);
    if (usd === null) throw new Error(`推荐组合 ${id} 算不出月成本`);
    return [plan, { usd: cents(usd), cny: cents(usd * CNY_PER_USD) }];
  });
  return Object.fromEntries(entries);
}
