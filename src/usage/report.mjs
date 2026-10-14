// 用量报表：今天、本月、累计各调了几次模型、多少 token、花了多少钱、模型一般多久回话，以及按型号分开的累计。
// 命令行（speakmore usage）和历史窗口用的是同一份。数据是历史库里的账（src/storage/history.mjs 的 usage），
// 钱是按官方标准价估算的美元（src/server/providers/prices）。

/** 从快到慢排好的一串数里取第 p 分位（最近秩法：至少 p 那么多的数不比它大）。空的是 null */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

/**
 * 一段时间的汇总 → 报表里的一项：加上 token 合计；每次听写等了多久，换成一般多久（中位数）、慢的时候多久
 * （九成都比它快）。还没听写过的是 null，不是 0 秒
 */
function summarize({ latenciesMs, models: _models, ...totals }) {
  return {
    ...totals,
    tokens: totals.inputTokens + totals.outputTokens,
    latency:
      latenciesMs.length === 0 ? null : { medianMs: percentile(latenciesMs, 0.5), p90Ms: percentile(latenciesMs, 0.9) },
  };
}

/**
 * @param {{ usage(range?: { since?: string }): object }} history 打开着的历史库
 * @param {{ now: Date }} options 今天、本月按本机的时区算
 * @returns {{ today: object, month: object, total: object, models: object[] }}
 */
export function usageReport(history, { now }) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const firstOfMonth = new Date(midnight);
  firstOfMonth.setDate(1);
  const total = history.usage();
  return {
    today: summarize(history.usage({ since: midnight.toISOString() })),
    month: summarize(history.usage({ since: firstOfMonth.toISOString() })),
    total: summarize(total),
    models: total.models.map(summarize),
  };
}
