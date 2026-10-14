// 命令行各个画面共用的排版：上色、按终端里占几格对齐、数字和时长的写法。

export const INDENT = "  ";

/** @param {boolean} color 输出的是不是一个支持颜色的终端 */
export function paint(color) {
  const wrap = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
  return { bold: wrap(1), dim: wrap(2), green: wrap(32), red: wrap(31), yellow: wrap(33) };
}

/** 一个汉字或全角标点在终端里占两格 */
export function displayWidth(text) {
  let width = 0;
  for (const char of text) width += char.codePointAt(0) >= 0x2e80 ? 2 : 1;
  return width;
}

export const padEnd = (text, width) => text + " ".repeat(Math.max(0, width - displayWidth(text)));
export const row = (label, value) => `${INDENT}${padEnd(label, 10)}${value}`;
export const count = (number) => number.toLocaleString("zh-CN");

export function duration(seconds) {
  const total = Math.round(seconds);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (total < 3600) return total % 60 === 0 ? `${minutes} 分钟` : `${minutes} 分 ${total % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
