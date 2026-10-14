import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_MODEL_CHOICE,
  DEFAULT_THINKING_LEVEL,
  findProvider,
  formatModelChoice,
  parseModelChoice,
} from "../server/providers/index.mjs";
import { DEFAULT_THEME, findTheme, THEMES } from "../themes/index.mjs";

// 用户能改的几项设置，存在数据目录的 settings.json 里。
// 取值的顺序：环境变量（只管这一次运行）优先于文件，文件优先于默认值。key 不在这里，它单独加密保存。

/**
 * 热键是单独一个修饰键。原版 Typeless 用 fn；这里默认右 Option，这样两个可以同时开着用。
 * 名字要能直接嵌进中文句子里（"按一下右 Option 键开始说话"），所以都以汉字开头、以"键"结尾。
 */
export const HOTKEYS = {
  right_option: "右 Option 键",
  right_command: "右 Command 键",
  right_control: "右 Control 键",
  fn: "地球仪（fn）键",
};

/** 同一批热键写在悬浮条提示里的短名字：那里地方小，写不下"右 Option 键" */
export const HOTKEY_KEYCAPS = {
  right_option: "右⌥",
  right_command: "右⌘",
  right_control: "右⌃",
  fn: "fn",
};

const THEME_IDS = THEMES.map((theme) => theme.id);
const THINKING_LEVELS = findProvider("gemini").thinkingLevels;

/**
 * 每一项：对应的环境变量、默认值、能填的值（不限时为 null）、把写法规整并校验的函数。
 * label 可有可无：值本身不好懂时（right_option、cinnabar）给出它叫什么。
 * legacyEnv 可有可无：改名之前的环境变量，env 没设时照样认（README 里写过，用的人可能还在用）。
 * store 可有可无：规整后的值写进文件时换成什么样子（默认原样）。
 */
export const SETTINGS = {
  hotkey: {
    env: "SPEAKMORE_HOTKEY",
    default: "right_option",
    describe: "按哪个键开始和结束说话",
    choices: Object.keys(HOTKEYS),
    parse(value) {
      if (!Object.hasOwn(HOTKEYS, value)) throw new Error(`要是 ${Object.keys(HOTKEYS).join(" / ")} 之一`);
      return value;
    },
    label: (value) => HOTKEYS[value],
  },
  model: {
    env: "SPEAKMORE_MODEL",
    // 0.3 以前只有 Gemini，这个环境变量只写模型名
    legacyEnv: "GEMINI_MODEL",
    default: formatModelChoice(DEFAULT_MODEL_CHOICE),
    describe: "用哪一家的哪个模型整理，写成 厂商/模型；只写厂商就用它的默认模型。换模型用 speakmore model",
    choices: null,
    parse(value) {
      // 存下来的统一是 厂商/模型。0.3 以前文件里只写 Gemini 的模型名，读的时候照样认（见 parseModelChoice）
      return formatModelChoice(parseModelChoice(value));
    },
    label: (value) => findProvider(parseModelChoice(value).provider).name,
    // Gemini 的照 0.3 的写法只存模型名：退回 0.3 时它把整个值当 Gemini 的模型名用，gemini/… 会让每次请求都失败
    store(value) {
      const { provider, model } = parseModelChoice(value);
      return provider === "gemini" ? model : value;
    },
  },
  thinking: {
    env: "GEMINI_THINKING_LEVEL",
    default: DEFAULT_THINKING_LEVEL,
    describe: "Gemini 的思考档位，越高越慢。别家的模型用不上",
    choices: THINKING_LEVELS,
    parse(value) {
      const level = value.toUpperCase();
      if (!THINKING_LEVELS.includes(level)) throw new Error(`要是 ${THINKING_LEVELS.join(" / ")} 之一`);
      return level;
    },
  },
  theme: {
    env: "SPEAKMORE_THEME",
    default: DEFAULT_THEME,
    describe: "界面用哪套主题",
    choices: THEME_IDS,
    parse(value) {
      // 写 id 或写名字都认（cinnabar、朱砂），存下来的统一是 id
      const theme = findTheme(value.trim());
      if (theme === null) throw new Error(`要是 ${THEME_IDS.join(" / ")} 之一`);
      return theme.id;
    },
    label: (value) => findTheme(value).name,
  },
};

function settingNamed(name) {
  if (!Object.hasOwn(SETTINGS, name)) {
    throw new Error(`没有 ${JSON.stringify(name)} 这项设置。能改的有：${Object.keys(SETTINGS).join("、")}`);
  }
  return SETTINGS[name];
}

function parseValue(name, value, where) {
  try {
    if (typeof value !== "string") throw new Error("要是一段文字");
    return SETTINGS[name].parse(value);
  } catch (error) {
    throw new Error(`${where} 写的是 ${JSON.stringify(value)}，${error.message}`);
  }
}

function readFile(file) {
  if (!existsSync(file)) return {};
  let stored;
  try {
    stored = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`设置文件 ${file} 读不出来（${error.message}）。改好它，或者删掉重新设置。`);
  }
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error(`设置文件 ${file} 的内容不是一组"名字: 值"。改好它，或者删掉重新设置。`);
  }
  return stored;
}

function writeFile(file, stored) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
}

/** 这一项现在被哪个环境变量盖着（新名字优先于改名前的）；没有就是 null */
export function overridingEnv(name, env) {
  const setting = settingNamed(name);
  for (const variable of [setting.env, setting.legacyEnv]) {
    if (variable && env[variable] !== undefined) return variable;
  }
  return null;
}

/**
 * 现在生效的设置，以及每一项是从哪来的。
 * @returns {Record<keyof typeof SETTINGS, { value: string, source: "env" | "file" | "default", env?: string }>}
 *   来自改名前的环境变量时，env 写着是哪一个
 */
export function resolveSettings({ file, env }) {
  const stored = readFile(file);
  const resolved = {};
  for (const [name, setting] of Object.entries(SETTINGS)) {
    const variable = overridingEnv(name, env);
    if (variable !== null) {
      const value = parseValue(name, env[variable], `环境变量 ${variable}`);
      resolved[name] = variable === setting.env ? { value, source: "env" } : { value, source: "env", env: variable };
    } else if (stored[name] !== undefined) {
      resolved[name] = { value: parseValue(name, stored[name], `设置文件 ${file} 里的 ${name}`), source: "file" };
    } else {
      resolved[name] = { value: setting.default, source: "default" };
    }
  }
  return resolved;
}

/** 校验并保存一项设置。返回规整后的值 */
export function saveSetting(file, name, value) {
  settingNamed(name);
  const parsed = parseValue(name, value, name);
  writeFile(file, { ...readFile(file), [name]: SETTINGS[name].store?.(parsed) ?? parsed });
  return parsed;
}

/** 取消一项设置，让它回到默认值 */
export function unsetSetting(file, name) {
  settingNamed(name);
  const { [name]: _removed, ...rest } = readFile(file);
  writeFile(file, rest);
}
