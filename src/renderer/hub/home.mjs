import { formatCount, formatSeconds, formatSpan, formatTokens, formatUsd } from "../../usage/format.mjs";
import { activityGrid } from "../../usage/insights.mjs";

// 首页：原版"洞察"那一列——四个数、活跃天数和热力图，再加我们的花费；右边一列是口述卡和版本。
// 数是主进程从全部历史里算好的（src/usage/insights.mjs），这里只管画。

const $ = (id) => document.getElementById(id);

/** 热力图上每个格子多宽（加上间隔），和 hub.css 里的 --cell、--gap 一致：0.875rem + 0.375rem */
const CELL_PITCH = 20;
const LEVEL_NAMES = ["没有活动", "轻度使用", "中度使用", "高使用频率", "强力使用"];
const MONTHS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
const dayLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" });

/** 一个数加一个小一号的单位；还没有数时是两道横线，和原版一样 */
function setValue(element, value, unit) {
  if (value === null) {
    element.textContent = "--";
    element.dataset.empty = "";
    return;
  }
  delete element.dataset.empty;
  const unitNode = document.createElement("span");
  unitNode.className = "unit";
  unitNode.textContent = unit;
  element.replaceChildren(value, unitNode);
}

function setSpan(element, seconds) {
  const { value, unit } = formatSpan(seconds);
  setValue(element, value, unit);
}

/**
 * @param {{ onOpenSettings: () => void }} options
 */
export function createHome() {
  /** 最近一次拿到的统计；窗口变宽变窄时热力图要按它重画 */
  let latest = null;
  /** 热力图往前翻了几页（一页是当前能放下的那么多周）；0 是最近的 */
  let pagesBack = 0;
  let weeks = 0;

  function renderStats(insights) {
    const empty = insights.activeDays === 0;
    setValue($("stat-words"), empty ? null : formatCount(insights.words), "字");
    if (empty) {
      for (const id of ["stat-saved", "stat-time", "stat-speed"]) setValue($(id), null);
    } else {
      setSpan($("stat-saved"), insights.savedSeconds);
      setSpan($("stat-time"), insights.seconds);
      setValue($("stat-speed"), String(insights.wordsPerMinute), "字/分");
    }
    setValue($("stat-active"), String(insights.activeDays), "天");
    setValue($("stat-current"), String(insights.currentStreak), "天");
    setValue($("stat-longest"), String(insights.longestStreak), "天");
  }

  function renderHeatmap() {
    if (latest === null) return;
    const container = $("heatmap-cells");
    // 放得下几周就画几周，至少一周
    weeks = Math.max(1, Math.floor((container.clientWidth + 6) / CELL_PITCH));
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - pagesBack * weeks * 7);
    const grid = activityGrid({ perDay: latest.perDay, firstDay: latest.firstDay, end, today, weeks });

    container.replaceChildren(
      ...grid.columns.flat().map((cell) => {
        const node = document.createElement("span");
        node.className = "cell";
        node.dataset.level = String(cell.level);
        node.dataset.state = cell.state;
        if (cell.state !== "future") {
          const [year, month, date] = cell.day.split("-").map(Number);
          const label = dayLabel.format(new Date(year, month - 1, date));
          node.title =
            cell.state === "before"
              ? `${label} · 还没开始用`
              : `${label} · ${cell.count > 0 ? `${cell.count} 次 · ` : ""}${LEVEL_NAMES[cell.level]}`;
        }
        return node;
      }),
    );
    // 月份写在这个月 1 号所在那一列的下面；列之间是均匀撑开的，按比例放
    const pitch = weeks > 1 ? (container.clientWidth - 14) / (weeks - 1) : 0;
    $("heatmap-months").replaceChildren(
      ...grid.months.map(({ column, month }) => {
        const label = document.createElement("span");
        label.textContent = MONTHS[month];
        label.style.left = `${column * pitch}px`;
        return label;
      }),
    );
    $("heatmap-next").disabled = pagesBack === 0;
    // 第一天之前没什么可看的：最早一列已经在开始用之前了就不再往前翻
    const first = grid.columns[0][0].day;
    $("heatmap-back").disabled = latest.firstDay === null || first <= latest.firstDay;
  }

  /** 用量表里的一行：今天、本月或累计 */
  function spendRow(label, period) {
    const tr = document.createElement("tr");
    const head = document.createElement("th");
    head.scope = "row";
    head.textContent = label;
    const cells = [
      [formatUsd(period.costUsd), "cost"],
      [formatTokens(period.tokens)],
      [String(period.dictations)],
      [period.latency ? formatSeconds(period.latency.medianMs) : "—"],
    ].map(([text, className]) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (className) td.className = className;
      return td;
    });
    tr.append(head, ...cells);
    return tr;
  }

  function renderSpend(report) {
    const card = $("spend");
    card.hidden = report.total.calls === 0;
    if (card.hidden) return;
    $("spend-month").textContent = formatUsd(report.month.costUsd);
    $("spend-rows").replaceChildren(
      spendRow("今天", report.today),
      spendRow("本月", report.month),
      spendRow("累计", report.total),
    );
    // 只在数字不全时说一句：有的型号没有标价，那几次没算进花费
    const unpriced = report.models.filter(({ unpricedCalls }) => unpricedCalls > 0);
    $("spend-note").hidden = unpriced.length === 0;
    $("spend-note").textContent =
      unpriced.length === 0
        ? ""
        : `${unpriced.map(({ model }) => model).join("、")} 无标价，${report.total.unpricedCalls} 次未计入`;
  }

  $("heatmap-back").addEventListener("click", () => {
    pagesBack++;
    renderHeatmap();
  });
  $("heatmap-next").addEventListener("click", () => {
    pagesBack = Math.max(0, pagesBack - 1);
    renderHeatmap();
  });
  // 窗口拉宽拉窄时，能放下的周数跟着变
  new ResizeObserver(() => renderHeatmap()).observe($("heatmap-cells"));

  return {
    /**
     * @param {{ insights: object, usage: object, app: { version: string, hotkeyKeycap: string } }} data
     */
    render({ insights, usage, app }) {
      latest = insights;
      renderStats(insights);
      renderHeatmap();
      renderSpend(usage);
      $("home-keycap").textContent = app.hotkeyKeycap;
      $("home-version").textContent = `v${app.version}`;
    },
  };
}
