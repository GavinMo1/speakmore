import { formatSeconds, formatTokens, formatUsd } from "../../usage/format.mjs";

// 历史窗口：上面是用量（花了多少钱、多少 token、模型多久回话），下面列出最近的听写，可以复制。
// 有新记录、记了新的账时主进程会通知这里重新读一遍。

const usage = document.getElementById("usage");
const usageRows = document.getElementById("usage-rows");
const usageNote = document.getElementById("usage-note");
const list = document.getElementById("list");
const template = document.getElementById("entry");
const summary = document.getElementById("summary");
const empty = document.getElementById("empty");
const loadError = document.getElementById("load-error");

const clock = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDuration(seconds) {
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole} 秒` : `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`;
}

function renderEntry(row) {
  const node = template.content.firstElementChild.cloneNode(true);
  const time = node.querySelector("time");
  time.dateTime = row.createdAt;
  time.textContent = clock.format(new Date(row.createdAt));
  // 写明是录音：旁边还有一个"模型 1.7 秒"
  node.querySelector(".duration").textContent = `录音 ${formatDuration(row.duration)}`;
  if (row.usage) {
    // 这一条等了模型多久、花了多少；token 细节放在悬停提示里，行里放不下
    const spent = node.querySelector(".spent");
    const cost = row.usage.costUsd === null ? "价格不明" : formatUsd(row.usage.costUsd);
    spent.textContent = `模型 ${formatSeconds(row.usage.latencyMs)} · ${cost}`;
    spent.title =
      `输入 ${formatTokens(row.usage.inputTokens)} token，输出 ${formatTokens(row.usage.outputTokens)} token` +
      (row.usage.calls > 1 ? `；调了 ${row.usage.calls} 次模型` : "");
    spent.hidden = false;
  }

  const text = node.querySelector(".text");
  const copy = node.querySelector(".copy");
  if (row.status === "failed") {
    node.classList.add("is-failed");
    node.querySelector(".failed").hidden = false;
    text.textContent = row.error;
    copy.hidden = true;
  } else if (row.refinedText === "") {
    node.classList.add("is-silent");
    text.textContent = "没有听到声音";
    copy.hidden = true;
  } else {
    text.textContent = row.refinedText;
    copy.addEventListener("click", async () => {
      try {
        await window.speakmore.copyText(row.refinedText);
        copy.textContent = "已复制";
      } catch (error) {
        console.error("复制失败", error);
        copy.textContent = "复制失败";
      }
      setTimeout(() => {
        copy.textContent = "复制";
      }, 1500);
    });
  }
  return node;
}

/** 用量表里的一行：今天、本月或累计 */
function usageRow(label, period) {
  const tr = document.createElement("tr");
  const head = document.createElement("th");
  head.scope = "row";
  head.textContent = label;
  const cells = [
    [formatUsd(period.costUsd), "cost"],
    [formatTokens(period.tokens)],
    [String(period.dictations)],
    [period.latency ? `一般 ${formatSeconds(period.latency.medianMs)}` : "—"],
  ].map(([text, className]) => {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  });
  tr.append(head, ...cells);
  return tr;
}

function renderUsage(report) {
  usage.hidden = report.total.calls === 0;
  if (usage.hidden) return;
  usageRows.replaceChildren(
    usageRow("今天", report.today),
    usageRow("本月", report.month),
    usageRow("累计", report.total),
  );
  const { total } = report;
  const notes = [];
  if (total.latency) {
    notes.push(
      `模型一般 ${formatSeconds(total.latency.medianMs)}回话，慢的时候 ${formatSeconds(total.latency.p90Ms)}。`,
    );
  }
  const unpriced = report.models.filter(({ unpricedCalls }) => unpricedCalls > 0);
  if (unpriced.length > 0) {
    notes.push(
      `${unpriced.map(({ model }) => model).join("、")} 不在价目表里，这 ${total.unpricedCalls} 次的钱没算进去。`,
    );
  }
  if (total.cacheCostUsd > 0) notes.push(`花费里有 ${formatUsd(total.cacheCostUsd)} 是提示词缓存的（建缓存、存着）。`);
  notes.push("花费按各家官方标准价估算（美元），Gemini 免费额度内用的其实不收钱。");
  usageNote.textContent = notes.join("");
}

async function refresh() {
  let rows;
  let report;
  try {
    [rows, report] = await Promise.all([window.speakmore.listHistory(), window.speakmore.usageReport()]);
  } catch (error) {
    console.error("读历史失败", error);
    loadError.textContent = `历史记录读不出来：${error.message}`;
    loadError.hidden = false;
    return;
  }
  loadError.hidden = true;
  renderUsage(report);
  empty.hidden = rows.length > 0;
  const completed = rows.filter((row) => row.status === "completed").length;
  summary.textContent = rows.length === 0 ? "" : `最近 ${rows.length} 条，其中 ${rows.length - completed} 条失败`;
  list.replaceChildren(...rows.map(renderEntry));
}

window.speakmore.onHistoryChanged(refresh);
refresh();
