import { formatSeconds, formatTokens, formatUsd } from "../../usage/format.mjs";
import { h, platformName } from "../shared/dom.mjs";
import { t } from "../shared/i18n.mjs";
import { providerIcon } from "../shared/provider-icons.mjs";
import { slidingIndicators } from "./indicators.mjs";
import { curvePath, smoothed, spreadFor } from "./trend.mjs";

// 首页的花费卡：上面是这段时间花了多少、选时段；中间是花费随时间怎么走的柱子；下面每个型号一行，名字下面一道线是它占几成。
// 柱子只用主题色一种：型号多了配一堆颜色反而认不出谁是谁。想看某个型号，指着它那一条，柱子里只亮它那一份。
// 柱子上叠一条淡的平滑曲线（trend.mjs），柱子密了也看得出起伏；指着型号时曲线换成它自己的走势。
// 指着柱子看那一格花了多少、各型号各多少；指着型号，那一行露出它的 token、次数、一般多久回话。
// 数是主进程算好的（src/usage/report.mjs、src/usage/series.mjs），这里只管画。

const $ = (id) => document.getElementById(id);

const format = (options) => new Intl.DateTimeFormat(t.locale, options);
/** 横轴上的刻度怎么写：钟头写"6时"，天和周写"10月1日"，月写"10月"（跨了年带上年） */
const TICK = {
  hour: format({ hour: "numeric" }),
  day: format({ month: "short", day: "numeric" }),
  week: format({ month: "short", day: "numeric" }),
  month: format({ month: "short" }),
  year: format({ year: "numeric", month: "short" }),
};
/** 指着一根柱子时，上面那一行写哪一段时间 */
const SPAN = {
  hour: format({ hour: "numeric", minute: "2-digit" }),
  day: format({ month: "long", day: "numeric", weekday: "short" }),
  week: format({ month: "short", day: "numeric" }),
  month: format({ year: "numeric", month: "long" }),
};

/** 一格是哪段时间 */
function spanText(unit, start) {
  if (unit === "hour") {
    return SPAN.hour.formatRange(
      start,
      new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours() + 1),
    );
  }
  if (unit === "week") {
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return t("home.range", { from: SPAN.week.format(start), to: SPAN.week.format(end) });
  }
  return SPAN[unit].format(start);
}

/** 横轴上标哪几格：钟头标 0、6、12、18 点；一个月以内的天每周一个；再多就首尾加中间三个，均匀撒开 */
function tickIndexes(unit, count) {
  if (unit === "hour") return [0, 6, 12, 18].filter((index) => index < count);
  if (unit === "day" && count <= 31) return Array.from({ length: Math.ceil(count / 7) }, (_, week) => week * 7);
  return [...new Set([0, 1, 2, 3, 4].map((part) => Math.round((part * (count - 1)) / 4)))];
}

/** 一个型号叫什么：图标、名字；云上的跟着型号，本机的标"本机" */
function modelName(row) {
  const icon = row.icon ? providerIcon(row.icon) : null;
  // 云上的那一行 icon 就是厂商 id：名字按界面语言写（阿里云百炼 / Alibaba Cloud Bailian）
  const name = row.local ? row.name : platformName({ id: row.icon, name: row.name });
  return h(
    "span",
    { class: "spend-name" },
    icon,
    h("span", { class: "spend-name-text" }, name),
    h("span", { class: row.local ? "tag" : "spend-name-id" }, row.local ? t("home.local") : row.model),
  );
}

/** 占了这段时间花费的几成：不到 1% 写"<1%" */
function shareText(cost, total) {
  if (total <= 0 || cost <= 0) return "";
  const percent = (cost / total) * 100;
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

export function createSpend() {
  const card = $("spend");
  const plot = $("spend-plot");
  const tip = $("spend-tip");
  /** 选时段的分段控件，底块跟着选中的那一段滑 */
  const indicators = slidingIndicators(card);
  /** 看的是哪一段：today / month / total。默认本月 */
  let periodName = "month";
  /** 最近一次的用量报表，切换时段时重画用 */
  let usage = null;

  const period = () => usage[periodName];
  /** 有的型号没有标价时，钱只加得上知道价的那几笔 */
  const costText = (row) => (row.calls > 0 && row.unpricedCalls === row.calls ? "—" : formatUsd(row.costUsd));

  // ---------- 指着柱子时浮出来的小卡：那一格花了多少、各型号各多少 ----------

  /** 放在柱子旁边、不挡住它：柱子在左半边就放右边，在右半边就放左边；顶和柱子那块的顶对齐 */
  function showTip(column, ...kids) {
    tip.replaceChildren(...kids);
    tip.hidden = false;
    const box = card.getBoundingClientRect();
    const anchor = column.getBoundingClientRect();
    const { width } = tip.getBoundingClientRect();
    const gap = 8;
    const center = anchor.left + anchor.width / 2 - box.left;
    const left = center < box.width / 2 ? anchor.right - box.left + gap : anchor.left - box.left - width - gap;
    tip.style.left = `${Math.max(0, Math.min(left, box.width - width))}px`;
    tip.style.top = `${plot.getBoundingClientRect().top - box.top}px`;
  }

  const hideTip = () => {
    tip.hidden = true;
  };

  // ---------- 柱子 ----------

  /** 指着哪个型号（它的 key）；柱子里只亮它那一份。null 是都亮 */
  function focusModel(key) {
    for (const column of plot.children) {
      const bucket = period().series.buckets[Number(column.dataset.index)];
      const part = column.querySelector(".spend-bar-part");
      if (!part || bucket.costUsd === 0) continue;
      const share = key === null ? 1 : (bucket.models[key] ?? 0) / bucket.costUsd;
      part.style.height = `${share * 100}%`;
    }
    if (key === null) delete plot.dataset.focus;
    else plot.dataset.focus = "";
    drawTrend(key);
  }

  /** 柱子最高那根的钱：柱子和曲线按它算高 */
  let peak = 0;

  /**
   * 趋势线：到现在为止的每一格平滑一下，按柱子的比例画在柱子上（viewBox 横着一格一个单位、竖着 0–100）。
   * 还没到的格子不画；不到两格、或者一分钱没花，就不画
   * @param {string | null} key 只看哪个型号；null 是全部
   */
  function drawTrend(key) {
    const { buckets } = period().series;
    const past = buckets.filter(({ future }) => !future);
    const values = past.map((bucket) => (key === null ? bucket.costUsd : (bucket.models[key] ?? 0)));
    const trend = $("spend-trend");
    // SVG 元素没有 hidden 这个开关，直接增删属性
    const hidden = past.length < 2 || peak === 0;
    trend.toggleAttribute("hidden", hidden);
    if (hidden) return;
    trend.setAttribute("viewBox", `0 0 ${buckets.length} 100`);
    const points = smoothed(values, spreadFor(buckets.length)).map((value, index) => [
      index + 0.5,
      100 - (value / peak) * 100,
    ]);
    // 写成 CSS 的 d：点数不变时（换着指型号）曲线从上一个样子滑过去
    const d = `path("${curvePath(points)}")`;
    for (const path of trend.children) path.style.d = d;
  }

  function renderChart() {
    const { unit, buckets } = period().series;
    peak = Math.max(0, ...buckets.map(({ costUsd }) => costUsd));
    const peakIndex = peak > 0 ? buckets.findIndex(({ costUsd }) => costUsd === peak) : -1;
    plot.replaceChildren(
      ...buckets.map((bucket, index) => {
        const column = h("span", {
          class: "spend-col",
          "data-index": index,
          "data-future": bucket.future,
          "data-zero": !bucket.future && bucket.costUsd === 0,
        });
        // 最高的那根上面写它是多少：纵轴就不画了
        if (index === peakIndex) {
          const edge = index < 2 ? "start" : index > buckets.length - 3 ? "end" : null;
          column.append(h("span", { class: "spend-peak", "data-edge": edge }, formatUsd(peak)));
        }
        const bar = h("span", { class: "spend-bar" });
        if (bucket.costUsd > 0) {
          bar.style.height = `max(2px, ${(bucket.costUsd / peak) * 100}%)`;
          bar.append(h("span", { class: "spend-bar-part" }));
        }
        column.append(bar);
        return column;
      }),
    );

    // 横轴：头一个靠左、最后一个靠右，别的对着柱子的中间
    const years = new Set(buckets.map(({ start }) => new Date(start).getFullYear()));
    const tick = unit === "month" && years.size > 1 ? TICK.year : TICK[unit];
    const indexes = tickIndexes(unit, buckets.length);
    $("spend-ticks").replaceChildren(
      ...indexes.map((index) => {
        const label = h("span", { text: tick.format(new Date(buckets[index].start)) });
        if (index === 0) label.dataset.edge = "start";
        else if (index === buckets.length - 1) label.dataset.edge = "end";
        else label.style.left = `${((index + 0.5) / buckets.length) * 100}%`;
        return label;
      }),
    );

    // 一分钱都没花：说清是还没用过，还是用的都不花钱（本机转写）
    const blank = $("spend-blank");
    blank.hidden = peak > 0;
    blank.textContent = period().calls === 0 ? t("home.emptyPeriod") : t("home.noCost");
    drawTrend(null);
  }

  plot.addEventListener("pointermove", (event) => {
    const column = event.target.closest?.(".spend-col");
    const active = plot.querySelector(".spend-col[data-active]");
    if (column === active) return;
    active?.removeAttribute("data-active");
    if (!column || column.dataset.future !== undefined) {
      hideTip();
      return;
    }
    column.dataset.active = "";
    const { unit } = period().series;
    const bucket = period().series.buckets[Number(column.dataset.index)];
    const models = period()
      .models.filter(({ key }) => bucket.models[key] > 0)
      .sort((a, b) => bucket.models[b.key] - bucket.models[a.key]);
    showTip(
      column,
      h("span", { class: "spend-tip-head" }, spanText(unit, new Date(bucket.start))),
      h("span", { class: "spend-tip-value" }, formatUsd(bucket.costUsd)),
      ...models.map((row) =>
        h(
          "span",
          { class: "spend-tip-row" },
          modelName(row),
          h("span", { class: "spend-tip-num" }, formatUsd(bucket.models[row.key])),
        ),
      ),
    );
  });
  plot.addEventListener("pointerleave", () => {
    plot.querySelector(".spend-col[data-active]")?.removeAttribute("data-active");
    hideTip();
  });

  // ---------- 型号一条一条 ----------

  /** 一个型号的细数：多少 token、几次听写、一般多久回话。指着这一行时才露出来 */
  function detailText(row) {
    const parts = [];
    if (!row.local && row.tokens > 0) parts.push(t("home.tokenTotal", { count: formatTokens(row.tokens) }));
    if (row.dictations > 0) parts.push(t("home.dictations", { count: row.dictations }));
    if (row.latency) parts.push(t("home.latencyIs", { time: formatSeconds(row.latency.medianMs, t) }));
    return parts.join(" · ");
  }

  function renderModels() {
    const { models, costUsd } = period();
    $("spend-models").replaceChildren(
      ...models.map((row) => {
        // 名字下面一道细线，长短是占这段时间花费的几成：几条加起来正好铺满
        const fill = h("span", { class: "spend-fill" });
        if (costUsd > 0) fill.style.width = `${(row.costUsd / costUsd) * 100}%`;
        const item = h(
          "li",
          { class: "spend-item", tabindex: "0" },
          modelName(row),
          h("span", { class: "spend-detail" }, detailText(row)),
          h("span", { class: "spend-share" }, row.local ? "" : shareText(row.costUsd, costUsd)),
          h("span", { class: "spend-cost", "data-free": row.local }, row.local ? t("home.free") : costText(row)),
          h("span", { class: "spend-meter" }, fill),
        );
        // 指着哪一行，柱子里只亮它那一份
        for (const type of ["pointerenter", "focus"]) item.addEventListener(type, () => focusModel(row.key));
        for (const type of ["pointerleave", "blur"]) item.addEventListener(type, () => focusModel(null));
        return item;
      }),
    );
  }

  /** 底下一行小字：几次听写、多少 token、里面含了几次检查、多少是提示词缓存，有的型号没标价，钱是估算的 */
  function renderNote() {
    const now = period();
    const notes = [];
    if (now.dictations > 0) notes.push(t("home.dictations", { count: now.dictations }));
    if (now.tokens > 0) notes.push(t("home.tokenTotal", { count: formatTokens(now.tokens) }));
    if (now.checks > 0) notes.push(t("home.checks", { count: now.checks }));
    if (now.cacheCostUsd > 0) notes.push(t("home.cache", { cost: formatUsd(now.cacheCostUsd) }));
    const unpriced = now.models.filter(({ unpricedCalls }) => unpricedCalls > 0);
    if (unpriced.length > 0) {
      notes.push(t("home.unpriced", { models: t.list(unpriced.map(({ model }) => model)), count: now.unpricedCalls }));
    }
    notes.push(t("home.estimate"));
    $("spend-note").textContent = notes.join(" · ");
  }

  function render() {
    card.hidden = usage === null || usage.total.calls === 0;
    if (card.hidden) return;
    for (const segment of $("spend-periods").querySelectorAll(".segment")) {
      segment.setAttribute("aria-checked", String(segment.dataset.period === periodName));
    }
    indicators.place();
    hideTip();
    $("spend-total").textContent = formatUsd(period().costUsd);
    $("spend-label").textContent = t(`home.spend.${periodName}`);
    renderChart();
    renderModels();
    renderNote();
  }

  for (const segment of $("spend-periods").querySelectorAll(".segment")) {
    segment.addEventListener("click", () => {
      periodName = segment.dataset.period;
      render();
    });
  }

  return {
    /** @param {object} report src/usage/report.mjs 的用量报表 */
    render(report) {
      usage = report;
      render();
    },

    /** 页面切到前台时，分段控件的底块要按真实宽度重新放（藏着时量不出来） */
    shown() {
      indicators.reset();
      indicators.place();
    },
  };
}
