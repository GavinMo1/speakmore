import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_MODEL, DEFAULT_THINKING_LEVEL, THINKING_LEVELS } from "./server/config.mjs";

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

/** 每一项：对应的环境变量、默认值、能填的值（不限时为 null）、把写法规整并校验的函数 */
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
  },
  model: {
    env: "GEMINI_MODEL",
    default: DEFAULT_MODEL,
    describe: "用哪个 Gemini 模型整理",
    choices: null,
    parse(value) {
      if (value.trim() === "") throw new Error("model 不能是空的");
      return value.trim();
    },
  },
  thinking: {
    env: "GEMINI_THINKING_LEVEL",
    default: DEFAULT_THINKING_LEVEL,
    describe: "模型的思考档位，越高越慢",
    choices: THINKING_LEVELS,
    parse(value) {
      const level = value.toUpperCase();
      if (!THINKING_LEVELS.includes(level)) throw new Error(`要是 ${THINKING_LEVELS.join(" / ")} 之一`);
      return level;
    },
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

/**
 * 现在生效的设置，以及每一项是从哪来的。
 * @returns {Record<keyof typeof SETTINGS, { value: string, source: "env" | "file" | "default" }>}
 */
export function resolveSettings({ file, env }) {
  const stored = readFile(file);
  const resolved = {};
  for (const [name, setting] of Object.entries(SETTINGS)) {
    if (env[setting.env] !== undefined) {
      resolved[name] = { value: parseValue(name, env[setting.env], `环境变量 ${setting.env}`), source: "env" };
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
  writeFile(file, { ...readFile(file), [name]: parsed });
  return parsed;
}

/** 取消一项设置，让它回到默认值 */
export function unsetSetting(file, name) {
  settingNamed(name);
  const { [name]: _removed, ...rest } = readFile(file);
  writeFile(file, rest);
}
