import { ensureHome } from "../../storage/paths.mjs";
import { SETTINGS, saveSetting, unsetSetting } from "../../storage/settings.mjs";
import { THEMES } from "../../themes/index.mjs";
import {
  ConfigError,
  currentSettings,
  noPositionals,
  PACKAGED_NOTE,
  PACKAGED_RELAUNCH,
  parse,
  renderOptions,
  UsageError,
} from "../common.mjs";
import { renderConfig, renderThemes, themeTitle } from "../render/settings.mjs";

// 设置：speakmore config、theme，以及打开设置窗口的 speakmore settings。

/**
 * 设置改完之后让它生效：在运行就重启，并看重启之后的结果。
 * @param {string | null} undo 这次改动怎么撤回，重启后不能用时告诉用户；没有可撤回的时为 null
 * @returns {Promise<number>} 退出码
 */
export async function applySettings(io, undo) {
  const current = await io.daemon.status();
  if (current === null) {
    io.out("下次启动生效。");
    return 0;
  }
  if (current.packaged) {
    // 从这里重启的话，起来的会是终端启动的那一个，不是它
    io.out(`${PACKAGED_NOTE}要让新设置生效：${PACKAGED_RELAUNCH}。`);
    return 0;
  }
  io.out("正在重启 SpeakMore 让它生效…");
  await io.daemon.stop();
  const restarted = await io.daemon.start({ onProgress: io.out });
  // 模型名、思考档位写得对不对，要问过 Gemini 才知道
  if (restarted.key.state === "rejected" && restarted.key.cause === "other") {
    io.err(`重启了，但现在不能用：${restarted.key.problem}`);
    if (undo) io.err(`想撤回这次改动：${undo}`);
    return 1;
  }
  if (restarted.starting) io.out("重启了，还没准备好：运行 speakmore status 看看。");
  else if (restarted.key.verified === false) {
    io.out("重启了，但没连上 Gemini，新设置对不对还没验证：过一会儿运行 speakmore status 看看。");
  } else io.out("已经生效。");
  return 0;
}

/**
 * 主题改完之后让它生效。主题不用重启：让正在运行的那个重新读一遍设置，开着的窗口当场换。
 * @param {string} wanted 设置里现在写的那一套
 * @returns {Promise<number>} 退出码
 */
async function applyTheme(io, wanted) {
  if ((await io.daemon.status()) === null) {
    io.out("下次启动生效。");
    return 0;
  }
  let applied;
  try {
    applied = await io.daemon.request("reload-theme");
  } catch (error) {
    // 正在运行的是升级之前启动的那一个，还不认识这条命令
    if (!/^不认识的命令/.test(error?.message ?? "")) throw error;
    io.out("正在运行的 SpeakMore 是旧版本，不会当场换：运行 speakmore restart。");
    return 0;
  }
  if (applied.theme === wanted) io.out("已经生效，不用重启。");
  else {
    io.out(
      `正在运行的 SpeakMore 用的还是${themeTitle(applied.theme)}：启动它的环境里设着 ${SETTINGS.theme.env}，它盖过设置文件。`,
    );
  }
  return 0;
}

/** 校验并存下一项设置。@returns {string} 规整后的值 */
export function storeSetting(io, name, value) {
  try {
    // 可能是这个目录里的第一个文件
    ensureHome(io.paths);
    return saveSetting(io.paths.settingsFile, name, value);
  } catch (error) {
    throw new ConfigError(error.message);
  }
}

export function warnIfEnvOverrides(io, name) {
  if (io.env[SETTINGS[name].env] !== undefined) {
    io.out(`注意：环境变量 ${SETTINGS[name].env} 现在设着，它会盖过这个值。`);
  }
}

export async function config(args, io) {
  const [action, name, value, ...extra] = parse(args).positionals;

  if (action === undefined) {
    io.out(renderConfig({ settings: currentSettings(io), paths: io.paths }, renderOptions(io)));
    return 0;
  }
  if (action === "set" && name !== undefined && value !== undefined && extra.length === 0) {
    const saved = storeSetting(io, name, value);
    io.out(`${name} 改成了 ${saved}。`);
    warnIfEnvOverrides(io, name);
    return name === "theme" ? applyTheme(io, saved) : applySettings(io, `speakmore config unset ${name}`);
  }
  if (action === "unset" && name !== undefined && value === undefined) {
    try {
      unsetSetting(io.paths.settingsFile, name);
    } catch (error) {
      throw new ConfigError(error.message);
    }
    io.out(`${name} 回到了默认值 ${SETTINGS[name].default}。`);
    return name === "theme" ? applyTheme(io, SETTINGS.theme.default) : applySettings(io, null);
  }
  throw new UsageError("用法：speakmore config | speakmore config set <名字> <值> | speakmore config unset <名字>");
}

export async function theme(args, io) {
  const [wanted, ...extra] = parse(args).positionals;
  if (extra.length > 0) throw new UsageError("用法：speakmore theme | speakmore theme <名字>");
  if (wanted === undefined) {
    io.out(renderThemes({ themes: THEMES, setting: currentSettings(io).theme }, renderOptions(io)));
    return 0;
  }
  const saved = storeSetting(io, "theme", wanted);
  io.out(`主题换成了${themeTitle(saved)}。`);
  warnIfEnvOverrides(io, "theme");
  return applyTheme(io, saved);
}

export async function settings(args, io) {
  noPositionals(parse(args).positionals, "speakmore settings");
  if ((await io.daemon.status()) === null) {
    io.err("SpeakMore 没有在运行。先运行 speakmore 启动。");
    return 1;
  }
  await io.daemon.request("show-settings");
  io.out("设置窗口已经打开。");
  return 0;
}
