// 用量的写法：钱、token、等待时间。命令行（src/cli/render/usage.mjs）和历史窗口共用，两边写法一致。
// 纯函数，不碰 Node 也不碰页面：窗口的页面直接 import 这个文件。

/** token 数从小到大的缩写：千、百万、十亿 */
const TOKEN_UNITS = ["K", "M", "B"];

/** token 数：按千、百万、十亿缩写成 K、M、B，留三位有效数字（1.39K、21.3K、6.02M） */
export function formatTokens(count) {
  let value = count;
  let unit = "";
  for (const next of TOKEN_UNITS) {
    // 按缩写之后的样子判断，999,600 才会写成 1M 而不是 1000K
    if (Number(value.toPrecision(3)) < 1000) break;
    value /= 1000;
    unit = next;
  }
  return `${Number(value.toPrecision(3))}${unit}`;
}

/**
 * 美元。一次听写零点几分钱，留两位有效数字（$0.0011）；一块钱以上到分（$12.35）；不到万分之一的不细说。
 * 价格都是估算，多写几位也不更准
 */
export function formatUsd(usd) {
  if (usd === 0) return "$0";
  if (usd < 0.0001) return "<$0.0001";
  // 0.995 以上按两位有效数字会写成 1.0，改按到分写
  if (usd < 0.995) return `$${usd.toPrecision(2)}`;
  return `$${usd.toFixed(2)}`;
}

/** 等了多久：秒，一位小数 */
export const formatSeconds = (ms) => `${(ms / 1000).toFixed(1)} 秒`;
