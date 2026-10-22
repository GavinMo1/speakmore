import { formatCount, formatSpan } from "../../usage/format.mjs";
import { activityGrid } from "../../usage/insights.mjs";
import { t } from "../shared/i18n.mjs";
import { keycapGroups } from "../shared/keycaps.mjs";
import { createSpend } from "./spend.mjs";

// 首页：标题下面一行热键；原版"洞察"那一列——四个数、活跃天数和热力图，再加我们的花费。版本号写在侧栏底下。
// 数是主进程从全部历史里算好的（src/usage/insights.mjs、src/usage/report.mjs），这里只管画。
// 花费那张卡在 spend.mjs。

const $ = (id) => document.getElementById(id);

/** 热力图上每个格子多宽（加上间隔），和 hub.css 里的 --cell、--gap 一致：0.875rem + 0.375rem */
const CELL_PITCH = 20;
/** 热力图格子的五档，文案里的名字（home.levels.*）；月份同样（months.*） */
const LEVELS = ["none", "light", "moderate", "high", "power"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const dayLabel = new Intl.DateTimeFormat(t.locale, { month: "long", day: "numeric", weekday: "short" });

// 热力图左边那一列星期几（从星期日起）：按界面语言写最短的那种（S、M… / 日、一…）
const weekday = new Intl.DateTimeFormat(t.locale, { weekday: "narrow" });
document
  .getElementById("heatmap-weekdays")
  .replaceChildren(
    ...Array.from({ length: 7 }, (_, index) =>
      Object.assign(document.createElement("span"), { textContent: weekday.format(new Date(2026, 0, 4 + index)) }),
    ),
  );

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
  setValue(element, value, t(`units.${unit}`));
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
    setValue($("stat-words"), empty ? null : formatCount(insights.words), t("units.words", { count: insights.words }));
    if (empty) {
      for (const id of ["stat-saved", "stat-time", "stat-speed"]) setValue($(id), null);
    } else {
      setSpan($("stat-saved"), insights.savedSeconds);
      setSpan($("stat-time"), insights.seconds);
      setValue($("stat-speed"), String(insights.wordsPerMinute), t("units.wpm"));
    }
    const days = (count) => t("units.days", { count });
    setValue($("stat-active"), String(insights.activeDays), days(insights.activeDays));
    setValue($("stat-current"), String(insights.currentStreak), days(insights.currentStreak));
    setValue($("stat-longest"), String(insights.longestStreak), days(insights.longestStreak));
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
          const day = dayLabel.format(new Date(year, month - 1, date));
          const level = t(`home.levels.${LEVELS[cell.level]}`);
          node.title =
            cell.state === "before"
              ? t("home.notStarted", { day })
              : cell.count > 0
                ? t("home.dayCount", { day, count: cell.count, level })
                : t("home.dayLevel", { day, level });
        }
        return node;
      }),
    );
    // 月份写在这个月 1 号所在那一列的下面；列之间是均匀撑开的，按比例放
    const pitch = weeks > 1 ? (container.clientWidth - 14) / (weeks - 1) : 0;
    $("heatmap-months").replaceChildren(
      ...grid.months.map(({ column, month }) => {
        const label = document.createElement("span");
        label.textContent = t(`months.${MONTHS[month]}`);
        label.style.left = `${column * pitch}px`;
        return label;
      }),
    );
    $("heatmap-next").disabled = pagesBack === 0;
    // 第一天之前没什么可看的：最早一列已经在开始用之前了就不再往前翻
    const first = grid.columns[0][0].day;
    $("heatmap-back").disabled = latest.firstDay === null || first <= latest.firstDay;
  }

  const spend = createSpend();

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
     * @param {{ insights: object, usage: object, app: { version: string, hotkey: string } }} data
     */
    render({ insights, usage, app }) {
      latest = insights;
      renderStats(insights);
      renderHeatmap();
      spend.render(usage);
      $("home-keycap").replaceChildren(...keycapGroups(app.hotkeys.dictate));
      $("app-version").textContent = `v${app.version}`;
    },

    /** 页面切到前台时，分段控件的底块要按真实宽度重新放（藏着时量不出来） */
    shown() {
      spend.shown();
    },
  };
}
