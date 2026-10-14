import { INDENT, paint } from "./text.mjs";

// 历史（speakmore history）：按天分组，新的在前。

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 按给定时区拆出年月日、星期和"时:分" */
function localParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday)],
    time: `${parts.hour}:${parts.minute}`,
  };
}

function dayHeading(parts, now, timeZone) {
  const date = `${parts.month} 月 ${parts.day} 日`;
  const today = localParts(now, timeZone);
  if (parts.dayKey === today.dayKey) return `今天 · ${date}`;
  if (parts.dayKey === localParts(new Date(now.getTime() - 86_400_000), timeZone).dayKey) return `昨天 · ${date}`;
  // 不是今年的要带上年份，否则分不清是哪一年的 10 月 8 日
  return `${parts.year === today.year ? "" : `${parts.year} 年 `}${date} ${parts.weekday}`;
}

/**
 * @param {object} view
 * @param {Array<object>} view.rows 新的在前（历史库 list() 给的顺序）
 * @param {number} view.total 库里一共多少条
 * @param {{ color: boolean, now: Date, timeZone?: string }} options timeZone 不给就用系统的
 */
export function renderHistory({ rows, total }, { color, now, timeZone }) {
  const c = paint(color);
  if (rows.length === 0) {
    return `还没有听写记录。运行 ${c.bold("speakmore")} 启动之后，按一下热键说句话试试。\n`;
  }

  // "  14:32  " 之后才是文字，续行缩进到同一列
  const continuation = " ".repeat(INDENT.length + 5 + 2);
  const lines = [];
  let currentDay = null;
  for (const entry of rows) {
    const parts = localParts(new Date(entry.createdAt), timeZone);
    if (parts.dayKey !== currentDay) {
      if (currentDay !== null) lines.push("");
      lines.push(c.bold(dayHeading(parts, now, timeZone)));
      currentDay = parts.dayKey;
    }
    const body =
      entry.status === "completed"
        ? entry.refinedText.split("\n")
        : [
            c.red(`✗ 没有成功：${entry.error ?? "原因不明"}`),
            c.dim(`录音 ${entry.duration.toFixed(1)} 秒，留在 ${entry.audioLocalPath ?? "（没存下来）"}`),
          ];
    body.forEach((line, index) => {
      if (index === 0) lines.push(`${INDENT}${c.dim(parts.time)}  ${line}`);
      // 段落之间的空行不带缩进，免得行尾留一串空格
      else lines.push(line === "" ? "" : `${continuation}${line}`);
    });
  }

  if (rows.length < total) {
    lines.push("", c.dim(`显示最近 ${rows.length} 条，共 ${total} 条。speakmore history -n ${total} 看全部。`));
  }
  lines.push("");
  return lines.join("\n");
}
