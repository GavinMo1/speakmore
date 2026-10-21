// 花费随时间怎么走：把历史库按天或按钟头分好的账（history.usageOverTime）排成一格一格，首页花费卡画成柱子。
// 今天按钟头，本月按天，累计按用了多久定：三个月以内按天，两年以内按周，再久按月——格子太少柱子就稀了，太多就挤成一片。
// 纯函数，日期一律按本机日历算：主进程算好交给窗口。

/** 累计按天画最多画多少天；不到这么多天时至少画最近 MIN_DAYS 天，柱子不会只有稀稀拉拉几根 */
const MAX_DAYS = 90;
const MIN_DAYS = 30;
/** 累计按周画最多画多少周，再久按月 */
const MAX_WEEKS = 104;
const DAY_MS = 86_400_000;

/** 一个型号的键：哪家加型号。厂商的 id 里没有斜杠，型号里有也分得开 */
export const modelKey = ({ provider, model }) => `${provider}/${model}`;

const pad = (number) => String(number).padStart(2, "0");
/** 本机时间的一刻 → 用来对格子的字符串，精确到钟头 */
const stamp = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}`;

/** 库里的 slot（"YYYY-MM-DD" 或 "YYYY-MM-DD HH"）→ 本机时间的那一刻 */
function slotTime(slot) {
  const [year, month, day, hour = 0] = slot.split(/[- ]/).map(Number);
  return new Date(year, month - 1, day, hour);
}

/** 某一刻所在那一格从哪一刻起：这个钟头、这一天、这一周（周一起）、这个月 */
function startOf(unit, date) {
  const [year, month, day] = [date.getFullYear(), date.getMonth(), date.getDate()];
  if (unit === "hour") return new Date(year, month, day, date.getHours());
  if (unit === "day") return new Date(year, month, day);
  if (unit === "week") return new Date(year, month, day - ((date.getDay() + 6) % 7));
  return new Date(year, month, 1);
}

/** 下一格从哪一刻起。按日历加减，不按毫秒：夏令时那天也不会错位 */
function next(unit, date) {
  const [year, month, day] = [date.getFullYear(), date.getMonth(), date.getDate()];
  if (unit === "hour") return new Date(year, month, day, date.getHours() + 1);
  if (unit === "day") return new Date(year, month, day + 1);
  if (unit === "week") return new Date(year, month, day + 7);
  return new Date(year, month + 1, 1);
}

/**
 * 从 from 所在那一格排到 to 所在那一格，把每一行的钱加进它落在的那一格；范围外的行不算。
 * @param {{ slot: string, provider: string, model: string, costUsd: number }[]} rows
 * @param {{ unit: "hour" | "day" | "week" | "month", from: Date, to: Date, now: Date }} range
 * @returns {{ unit: string, buckets: { start: string, costUsd: number, models: Record<string, number>, future: boolean }[] }}
 *   start 是这一格从哪一刻起（ISO 8601）；models 按 modelKey 分开，只有花过钱或者用过的型号；future：还没到的格子
 */
export function timeSeries(rows, { unit, from, to, now }) {
  const buckets = [];
  const byStamp = new Map();
  const last = startOf(unit, to);
  for (let start = startOf(unit, from); start <= last; start = next(unit, start)) {
    const bucket = { start: start.toISOString(), costUsd: 0, models: {}, future: start > now };
    buckets.push(bucket);
    byStamp.set(stamp(start), bucket);
  }
  for (const row of rows) {
    const bucket = byStamp.get(stamp(startOf(unit, slotTime(row.slot))));
    if (!bucket) continue;
    const key = modelKey(row);
    bucket.costUsd += row.costUsd;
    bucket.models[key] = (bucket.models[key] ?? 0) + row.costUsd;
  }
  return { unit, buckets };
}

/**
 * 累计那一段：从第一笔账排到今天，按用了多久定按天、按周还是按月。
 * @param {{ slot: string, provider: string, model: string, costUsd: number }[]} rows 按天分的，老的在前
 * @param {{ now: Date }} options
 */
export function spanSeries(rows, { now }) {
  const today = startOf("day", now);
  const earliest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (MIN_DAYS - 1));
  const first = rows.length > 0 ? slotTime(rows[0].slot) : today;
  // 夏令时那几天差一个钟头，四舍五入回整天
  const days = Math.round((today - first) / DAY_MS) + 1;
  if (days <= MAX_DAYS) {
    return timeSeries(rows, { unit: "day", from: first < earliest ? first : earliest, to: today, now });
  }
  const unit = days <= MAX_WEEKS * 7 ? "week" : "month";
  return timeSeries(rows, { unit, from: first, to: today, now });
}
