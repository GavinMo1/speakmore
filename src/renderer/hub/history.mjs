import { formatSeconds, formatTokens, formatUsd } from "../../usage/format.mjs";

// 历史记录：按天分组（今天、昨天、再往前写日期），一行一条，鼠标移上去才出现复制和详情。
// 和原版一样一行只有时间和文字；我们多出来的录音时长、模型用时和花费放在详情的悬停提示里。

const $ = (id) => document.getElementById(id);

const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" });
const longDay = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" });
const longDayWithYear = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** 分组的标题：今天、昨天，再往前写几月几日星期几（不是今年的带上年份） */
function dayTitle(day, now) {
  const today = startOfDay(now);
  const days = Math.round((today - day) / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  return (day.getFullYear() === now.getFullYear() ? longDay : longDayWithYear).format(day);
}

function formatDuration(seconds) {
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole} 秒` : `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`;
}

/** 详情：录音多长、等了模型多久、花了多少，token 细节 */
function detailsOf(row) {
  const lines = [`录音 ${formatDuration(row.duration)}`];
  if (row.usage) {
    const cost = row.usage.costUsd === null ? "价格不明" : formatUsd(row.usage.costUsd);
    lines.push(`模型 ${formatSeconds(row.usage.latencyMs)} · ${cost}`);
    lines.push(
      `输入 ${formatTokens(row.usage.inputTokens)} · 输出 ${formatTokens(row.usage.outputTokens)} token` +
        (row.usage.calls > 1 ? ` · 调用 ${row.usage.calls} 次` : ""),
    );
  }
  return lines.join("\n");
}

export function createHistory() {
  const dayTemplate = $("history-day");
  const rowTemplate = $("history-row");

  function renderRow(row) {
    const node = rowTemplate.content.firstElementChild.cloneNode(true);
    const time = node.querySelector("time");
    time.dateTime = row.createdAt;
    time.textContent = clock.format(new Date(row.createdAt));

    const text = node.querySelector(".row-text");
    const copy = node.querySelector(".copy");
    if (row.status === "failed") {
      node.dataset.kind = "failed";
      text.textContent = row.error;
      copy.hidden = true;
    } else if (row.refinedText === "") {
      // 原版的说法：hub__history__item__empty__text
      node.dataset.kind = "silent";
      text.textContent = "音频无声";
      copy.hidden = true;
    } else {
      text.textContent = row.refinedText;
      copy.addEventListener("click", async () => {
        try {
          await window.speakmore.copyText(row.refinedText);
          copy.dataset.done = "";
          copy.title = "已复制";
        } catch (error) {
          console.error("复制失败", error);
          copy.title = "复制失败";
        }
        setTimeout(() => {
          delete copy.dataset.done;
          copy.title = "复制";
        }, 1500);
      });
    }

    const details = node.querySelector(".details");
    details.title = detailsOf(row);
    details.setAttribute("aria-label", details.title);
    return node;
  }

  return {
    /**
     * @param {{ rows: object[], app: { dataDir: string, hotkeyKeycap: string } }} data
     */
    render({ rows, app }) {
      $("history-error").hidden = true;
      $("history-dir").textContent = app.dataDir;
      $("history-empty").hidden = rows.length > 0;
      $("history-empty-text").textContent = `按 ${app.hotkeyKeycap} 说第一句`;

      const now = new Date();
      const groups = [];
      for (const row of rows) {
        const day = startOfDay(new Date(row.createdAt));
        const last = groups.at(-1);
        if (last && last.day.getTime() === day.getTime()) last.rows.push(row);
        else groups.push({ day, rows: [row] });
      }
      $("history-days").replaceChildren(
        ...groups.map(({ day, rows: dayRows }) => {
          const node = dayTemplate.content.firstElementChild.cloneNode(true);
          node.querySelector(".day-title").textContent = dayTitle(day, now);
          node.querySelector(".rows").replaceChildren(...dayRows.map(renderRow));
          return node;
        }),
      );
    },

    showError(message) {
      $("history-error").textContent = `读不出历史：${message}`;
      $("history-error").hidden = false;
    },
  };
}
