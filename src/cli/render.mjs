import { SETTINGS } from "../settings.mjs";
import { toRgb } from "../themes/color.mjs";
import { findTheme } from "../themes/index.mjs";

// 命令行各个画面的排版：状态面板、历史、设置、主题。都是"数据进、一段文字出"，不碰终端也不读文件。

const INDENT = "  ";

/** @param {boolean} color 输出的是不是一个支持颜色的终端 */
function paint(color) {
  const wrap = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
  return { bold: wrap(1), dim: wrap(2), green: wrap(32), red: wrap(31), yellow: wrap(33) };
}

/** 一个汉字或全角标点在终端里占两格 */
function displayWidth(text) {
  let width = 0;
  for (const char of text) width += char.codePointAt(0) >= 0x2e80 ? 2 : 1;
  return width;
}

const padEnd = (text, width) => text + " ".repeat(Math.max(0, width - displayWidth(text)));
const row = (label, value) => `${INDENT}${padEnd(label, 10)}${value}`;
const count = (number) => number.toLocaleString("zh-CN");

function duration(seconds) {
  const total = Math.round(seconds);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (total < 3600) return total % 60 === 0 ? `${minutes} 分钟` : `${minutes} 分 ${total % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

// ---------- 状态面板 ----------

function keyLine(key) {
  // 启动时够不着 Gemini 的话先用着，如实说还没验证
  const unverified = key.verified === false ? "；启动时没连上 Gemini，还没验证这把能不能用" : "";
  switch (key.state) {
    case "ready":
      if (key.source === "env") return `这次运行用的是环境变量 GEMINI_API_KEY 里的，没有保存${unverified}`;
      if (key.source === "external") return "连的是单独启动的服务端，key 在那边配";
      return unverified ? `已保存${unverified}` : "已保存，验证通过";
    case "checking":
      return "正在验证…";
    case "rejected":
      // 三种情况要做的事不一样，不能都说成"换一把"
      if (key.cause === "other") {
        return `验证没通过：${key.problem}。key 未必有问题，先看模型和档位：speakmore config`;
      }
      if (key.source === "env") {
        return `环境变量 GEMINI_API_KEY 里的 key 不能用：${key.problem}。改对它，或者去掉这个环境变量，再重新启动`;
      }
      return `不能用：${key.problem}。运行 speakmore key 换一把`;
    case "unreadable":
      return `${key.problem}：运行 speakmore key`;
    default:
      return "还没有填：运行 speakmore key";
  }
}

/** 设置里现在写的，和后台应用启动时带着的不一样的那几项 */
function pendingSettings(status, settings) {
  // 后台应用没报的项（连着单独启动的服务端时的模型）不比
  return Object.keys(SETTINGS).filter((name) => status[name] != null && status[name] !== settings[name].value);
}

function statsLine({ dictations, characters, seconds }, { withPace }) {
  const parts = [`${count(dictations)} 次`, `${count(characters)} 字`, duration(seconds)];
  // 每分钟多少字只在累计里给：一天里说得少时这个数跳得厉害，没有参考价值
  if (withPace && seconds >= 60) parts.push(`每分钟 ${count(Math.round(characters / (seconds / 60)))} 字`);
  return parts.join(" · ");
}

/**
 * @param {object} view
 * @param {object | null} view.status 后台应用报的状态（src/app/main.mjs 的 describeStatus）；没有在运行时是 null
 * @param {string} view.version 这个命令自己的版本，没有在运行时用它
 * @param {Record<string, { value: string }>} view.settings 现在的设置。面板上写的是后台应用正在用的，
 *   这一份只用来看两边一不一样
 * @param {{ today: object | null, total: object | null }} view.stats 没有历史库时两项都是 null
 * @param {{ color: boolean }} options
 */
export function renderStatus({ status, version, settings, stats }, { color }) {
  const c = paint(color);
  if (status === null) {
    return [`${c.bold(`SpeakMore ${version}`)} · 没有运行`, "", `${INDENT}运行 ${c.bold("speakmore")} 启动。`, ""].join(
      "\n",
    );
  }

  const { summary, permissions } = status;
  const state = status.starting
    ? "正在启动"
    : summary.ready
      ? c.green("运行中")
      : summary.missing.length > 0
        ? c.yellow(`运行中，还差 ${summary.missing.length} 样`)
        : "运行中，正在准备";
  const lines = [`${c.bold(`SpeakMore ${status.version}`)} · ${state}`, ""];

  if (summary.ready) {
    lines.push(
      `${INDENT}可以用了：点进任意输入框，按一下${status.hotkeyLabel}开始说话，再按一下结束，文字会贴进去。`,
      "",
    );
  } else if (!status.starting && summary.missing.length > 0) {
    lines.push(`${INDENT}还差：${summary.missing.join("、")}。`, "");
  }

  const mark = (granted) => (granted === null ? c.dim("…") : granted ? c.green("✓") : c.red("✗"));
  const cells = [
    `麦克风 ${mark(permissions.microphone === "granted")}`,
    `输入监控 ${mark(permissions.listen)}`,
    `辅助功能 ${mark(permissions.trusted)}`,
  ];
  // 写后台应用正在用的，不是现在设置里的：设置改了还没重启、或者启动它的那条命令上带着环境变量时，两者不一样
  const model =
    status.model === null
      ? "由单独启动的服务端决定"
      : // 旧版本的后台应用不报这两项
        `${status.model ?? settings.model.value}（${status.thinking ?? settings.thinking.value}）`;
  lines.push(
    row("key", keyLine(status.key)),
    row("权限", cells.join("   ")),
    row("热键", status.hotkeyLabel),
    row("模型", model),
  );
  // 旧版本的后台应用不报这一项
  if (status.theme != null) lines.push(row("主题", themeTitle(status.theme)));
  if (stats.total && stats.total.dictations > 0) {
    lines.push(
      row("今天", statsLine(stats.today, { withPace: false })),
      row("累计", statsLine(stats.total, { withPace: true })),
    );
  }

  const relaunch = status.packaged ? "在菜单栏点“听写”→“退出”，再打开一次 SpeakMore.app" : "运行 speakmore restart";
  const notes = [];
  const pending = pendingSettings(status, settings);
  if (pending.length > 0) notes.push(`设置里的 ${pending.join("、")} 和正在用的不一样，还没生效：${relaunch}。`);
  if (status.helper === "stopped") {
    notes.push(`按键监听的小程序停了，热键不会生效：${relaunch}。还是这样的话看 speakmore logs。`);
  }
  if (notes.length > 0) lines.push("", ...notes.map((note) => `${INDENT}${note}`));

  const permissionMissing =
    permissions.microphone !== "granted" || permissions.listen === false || permissions.trusted === false;
  if (permissionMissing) {
    lines.push("");
    if (summary.degraded) lines.push(`${INDENT}${summary.degraded}。`);
    lines.push(
      `${INDENT}运行 ${c.bold("speakmore settings")} 打开设置窗口：每项权限旁边有去系统设置的按钮，开关打开后点"重新检查"。`,
      c.dim(
        status.packaged
          ? `${INDENT}权限记在应用自己名下，在系统设置的列表里找“SpeakMore”。`
          : `${INDENT}权限记在启动 SpeakMore 的那个终端程序名下（比如“终端”或 iTerm），在系统设置的列表里找它。`,
      ),
    );
  }

  lines.push(
    "",
    c.dim(`${INDENT}speakmore history  看说过的话     speakmore config  看和改设置`),
    c.dim(`${INDENT}speakmore stop     停掉           speakmore help    全部命令`),
    "",
  );
  return lines.join("\n");
}

// ---------- 历史 ----------

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

// ---------- 设置和主题 ----------

/** "朱砂（cinnabar）"。叫不出名字的（比这个命令新的版本里才有的主题）照原样写 */
export function themeTitle(id) {
  const theme = findTheme(id);
  return theme ? `${theme.name}（${theme.id}）` : id;
}

const SOURCES = {
  default: () => "默认",
  file: () => "存在设置文件里",
  env: (setting) => `这次运行来自环境变量 ${setting.env}`,
};

/**
 * @param {object} view
 * @param {Record<string, { value: string, source: "env" | "file" | "default" }>} view.settings
 * @param {{ home: string, settingsFile: string, logFile: string }} view.paths
 * @param {{ color: boolean }} options
 */
export function renderConfig({ settings, paths }, { color }) {
  const c = paint(color);
  const valueWidth = Math.max(...Object.values(settings).map(({ value }) => displayWidth(value))) + 2;
  const lines = ["设置", ""];
  for (const [name, setting] of Object.entries(SETTINGS)) {
    const { value, source } = settings[name];
    const meaning = setting.label ? `${setting.label(value)} · ` : "";
    lines.push(
      row(name, `${c.bold(value)}${" ".repeat(valueWidth - displayWidth(value))}${meaning}${SOURCES[source](setting)}`),
      row("", c.dim(`${setting.describe}${setting.choices ? `。能填：${setting.choices.join(" / ")}` : ""}`)),
    );
  }
  lines.push(
    "",
    `${INDENT}改一项：speakmore config set hotkey fn`,
    `${INDENT}回到默认：speakmore config unset hotkey`,
    `${INDENT}换 key：speakmore key`,
    `${INDENT}换主题：speakmore theme`,
    "",
    row("目录", paths.home),
    row("设置文件", paths.settingsFile),
    row("日志", paths.logFile),
    "",
    c.dim(`${INDENT}程序、设置、key、历史、录音都在这一个目录里。`),
    c.dim(`${INDENT}不想用了：speakmore uninstall 会停掉后台，把它整个删掉。`),
    "",
  );
  return lines.join("\n");
}

/** 用一套主题的颜色在终端里画一小段悬浮条：取消、声波、完成。要终端支持 24 位色 */
function barPreview({ bar }) {
  const ink = (value) => `\x1b[38;2;${toRgb(value).join(";")}m`;
  const on = (value) => `\x1b[48;2;${toRgb(value).join(";")}m`;
  const gap = `${on(bar.surface)} `;
  return [
    gap,
    `${on(bar.ghost)}${ink(bar.ink)} ✕ `,
    gap,
    `${ink(bar.live)}▂▄▆█▅▃▂▄▆▃`,
    gap,
    `${on(bar.go)}${ink(bar.onGo)} ✓ `,
    gap,
    "\x1b[0m",
  ].join("");
}

/**
 * @param {object} view
 * @param {Array<{ id: string, name: string, describe: string, bar: object }>} view.themes
 * @param {{ value: string, source: "env" | "file" | "default" }} view.setting 现在的主题设置
 * @param {{ color: boolean, truecolor?: boolean }} options truecolor：终端支持 24 位色，可以画出颜色
 */
export function renderThemes({ themes, setting }, { color, truecolor = false }) {
  const c = paint(color);
  const idWidth = Math.max(...themes.map((theme) => theme.id.length)) + 3;
  const nameWidth = Math.max(...themes.map((theme) => displayWidth(theme.name))) + 3;
  const lines = ["主题", ""];
  for (const theme of themes) {
    const mark = theme.id === setting.value ? c.green("●") : " ";
    const preview = truecolor ? `${barPreview(theme)}   ` : "";
    lines.push(
      `${INDENT}${mark} ${c.bold(padEnd(theme.id, idWidth))}${padEnd(theme.name, nameWidth)}${preview}${c.dim(theme.describe)}`,
    );
  }
  const other = themes.find((theme) => theme.id !== setting.value) ?? themes[0];
  lines.push(
    "",
    `${INDENT}现在用的是${themeTitle(setting.value)} · ${SOURCES[setting.source](SETTINGS.theme)}`,
    `${INDENT}换一套：speakmore theme ${other.id}（当场生效，不用重启）`,
    "",
  );
  return lines.join("\n");
}
