import { SETTINGS } from "../../storage/settings.mjs";
import { toRgb } from "../../themes/color.mjs";
import { findTheme } from "../../themes/index.mjs";
import { displayWidth, INDENT, padEnd, paint, row } from "./text.mjs";

// 设置和主题（speakmore config、speakmore theme）。

/** "朱砂（cinnabar）"。叫不出名字的（比这个命令新的版本里才有的主题）照原样写 */
export function themeTitle(id) {
  const theme = findTheme(id);
  return theme ? `${theme.name}（${theme.id}）` : id;
}

const SOURCES = {
  default: () => "默认",
  file: () => "存在设置文件里",
  // 来自改名前的环境变量（GEMINI_MODEL）时，entry.env 写着是哪一个
  env: (setting, entry) => `这次运行来自环境变量 ${entry?.env ?? setting.env}`,
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
      row(
        name,
        `${c.bold(value)}${" ".repeat(valueWidth - displayWidth(value))}${meaning}${SOURCES[source](setting, settings[name])}`,
      ),
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
