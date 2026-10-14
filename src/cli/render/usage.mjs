import { findProvider } from "../../server/providers/index.mjs";
import { formatSeconds, formatTokens, formatUsd } from "../../usage/format.mjs";
import { displayWidth, INDENT, paint } from "./text.mjs";

// 用量（speakmore usage）：今天、本月、累计花了多少钱、多少 token、模型多久回话，再按型号分开列累计。

const GAP = "   ";

/**
 * 几行几列排整齐：每列按最宽的那格补空格，align 里写 "right" 的列靠右（数字），其余靠左。
 * 行尾不留空格
 */
function columns(rows, align) {
  const widths = align.map((_, i) => Math.max(...rows.map((cells) => displayWidth(cells[i]))));
  return rows.map((cells) =>
    cells
      .map((cell, i) => {
        const pad = " ".repeat(widths[i] - displayWidth(cell));
        return align[i] === "right" ? pad + cell : cell + pad;
      })
      .join(GAP)
      .trimEnd(),
  );
}

const waiting = (latency) =>
  latency ? `一般 ${formatSeconds(latency.medianMs)}，慢时 ${formatSeconds(latency.p90Ms)}` : "—";

/** 一个型号的钱：全都不在价目表里时说不明 */
const costOf = ({ costUsd, calls, unpricedCalls }) => (unpricedCalls === calls ? "价格不明" : formatUsd(costUsd));

/**
 * @param {{ today: object, month: object, total: object, models: object[] } | null} report src/usage/report.mjs 给的；
 *   还没有历史库时是 null
 * @param {{ color: boolean }} options
 */
export function renderUsage(report, { color }) {
  const c = paint(color);
  if (report === null || report.total.calls === 0) {
    return `还没有用量记录。说一句话之后再来看：每次调模型花了多少钱、多少 token、多久回话，都会记下来。\n`;
  }
  const { total } = report;

  const periods = columns(
    [
      ["", "花费", "token", "听写", "模型回话"],
      ...[
        ["今天", report.today],
        ["本月", report.month],
        ["累计", total],
      ].map(([label, it]) => [
        label,
        formatUsd(it.costUsd),
        formatTokens(it.tokens),
        String(it.dictations),
        waiting(it.latency),
      ]),
    ],
    ["left", "right", "right", "right", "left"],
  );
  const models = columns(
    report.models.map((it) => [
      `${findProvider(it.provider)?.name ?? it.provider} ${it.model}`,
      costOf(it),
      formatTokens(it.tokens),
      `${it.dictations} 次`,
      it.latency ? `一般 ${formatSeconds(it.latency.medianMs)}` : "",
    ]),
    ["left", "right", "right", "right", "left"],
  );

  const notes = [
    `累计的 token：输入 ${formatTokens(total.inputTokens)}（其中音频 ${formatTokens(total.audioTokens)}、命中缓存 ${formatTokens(total.cachedTokens)}），` +
      `输出 ${formatTokens(total.outputTokens)}（其中思考 ${formatTokens(total.thinkingTokens)}）。`,
  ];
  if (total.checks > 0) notes.push(`验证 key 的 ${total.checks} 次也算在里面。`);
  const unpriced = report.models.filter(({ unpricedCalls }) => unpricedCalls > 0);
  if (unpriced.length > 0) {
    notes.push(
      `${unpriced.map(({ model }) => model).join("、")} 不在价目表里，这 ${total.unpricedCalls} 次的钱没算进去。`,
    );
  }
  notes.push("钱是按各家官方标准价估算的美元；Gemini 在免费额度内用的其实不收钱。");

  return [
    c.bold("用量"),
    "",
    `${INDENT}${c.dim(periods[0])}`,
    ...periods.slice(1).map((line) => `${INDENT}${line}`),
    "",
    `${INDENT}${c.bold("按型号（累计）")}`,
    ...models.map((line) => `${INDENT}${line}`),
    "",
    ...notes.map((note) => c.dim(`${INDENT}${note}`)),
    "",
  ].join("\n");
}
