import { findProvider, parseModelChoice } from "../../server/providers/index.mjs";
import { SETTINGS } from "../../storage/settings.mjs";
import { themeTitle } from "./settings.mjs";
import { count, duration, INDENT, paint, row } from "./text.mjs";

// 状态面板（speakmore、speakmore status）。和别的画面一样是"数据进、一段文字出"，不碰终端也不读文件。

/**
 * 后台应用正在用的模型。0.3 的后台应用报的是不带厂商的 Gemini 模型名，也不报 provider，照样认；
 * 连着单独启动的服务端时报 null，返回 null
 */
function modelInUse(status, settings) {
  if (status.model === null) return null;
  // 更旧的版本连 model 都不报
  return parseModelChoice(status.model ?? settings.model.value);
}

function keyLine(key, provider) {
  // 启动时够不着的话先用着，如实说还没验证
  const unverified = key.verified === false ? `；启动时没连上 ${provider.name}，还没验证这把能不能用` : "";
  switch (key.state) {
    case "ready":
      if (key.source === "env") return `这次运行用的是环境变量 ${provider.keyEnv} 里的，没有保存${unverified}`;
      if (key.source === "external") return "连的是单独启动的服务端，key 在那边配";
      return unverified ? `已保存${unverified}` : "已保存，验证通过";
    case "checking":
      return "正在验证…";
    case "rejected":
      // 三种情况要做的事不一样，不能都说成"换一把"
      if (key.cause === "other") {
        const what = provider.thinkingLevels ? "模型和档位" : "模型";
        return `验证没通过：${key.problem}。key 未必有问题，先看${what}：speakmore config`;
      }
      if (key.source === "env") {
        return `环境变量 ${provider.keyEnv} 里的 key 不能用：${key.problem}。改对它，或者去掉这个环境变量，再重新启动`;
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
  // 后台应用没报的项（连着单独启动的服务端时的模型、用不上思考档位的模型）不比；
  // 两边按同一个规矩写过再比，0.3 的后台应用报的旧写法（不带厂商的模型名）不算不一样
  const same = (name, reported) => {
    try {
      return SETTINGS[name].parse(String(reported)) === settings[name].value;
    } catch {
      return false;
    }
  };
  return Object.keys(SETTINGS).filter((name) => status[name] != null && !same(name, status[name]));
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
  const inUse = modelInUse(status, settings);
  const provider = findProvider(inUse?.provider ?? parseModelChoice(settings.model.value).provider);
  // 旧版本的后台应用不报思考档位；用不上档位的模型（报 null）就不写
  const thinking = provider.thinkingLevels ? (status.thinking ?? settings.thinking.value) : null;
  const model =
    inUse === null
      ? "由单独启动的服务端决定"
      : `${provider.name} 的 ${inUse.model}${thinking ? `（${thinking}）` : ""}`;
  lines.push(
    row("key", keyLine(status.key, provider)),
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
