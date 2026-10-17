import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { findLocale, LOCALES, LocalizedError, msg, problemOf, SYSTEM_LOCALE } from "../i18n/index.mjs";
import { DEFAULT_SOURCE, DEFAULT_TRANSCRIBER, MODELS, SOURCES } from "../models/catalog.mjs";
import { CLOUD_TRANSCRIBERS, cloudTranscriberOf } from "../server/asr/cloud/vendors.mjs";
import { formatChatChoice, normalizeBaseUrl, parseChatChoice } from "../server/chat/vendors.mjs";
import { DEFAULT_MODE, DEFAULT_POLISH, MODES, parseMode } from "../server/modes.mjs";
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
 * 热键是单独一个修饰键，能选哪几个按系统分（按键要由那个系统的原生小帮手认得）：
 *   macOS    原版 Typeless 用 fn；这里默认右 Option，这样两个可以同时开着用。
 *   Windows  右 Alt（默认，位置同 Mac 的右 Option）、右 Ctrl。右 Win 松开会弹开始菜单，fn 系统看不到，都不给。
 * 叫什么、在悬浮条上写成什么（hotkeys.<id>.name / keycap）在文案里，按界面语言写。Windows 的右 Ctrl 和 Mac 的
 * 右 Control 是同一个位置的键，叫法跟着各自系统的习惯，所以是两个 id。
 */
const HOTKEYS_BY_PLATFORM = {
  darwin: ["right_option", "right_command", "right_control", "fn"],
  win32: ["right_alt", "right_ctrl"],
};

/** 这个系统上能选的热键，第一个是默认的 */
export const hotkeyIdsFor = (platform) =>
  Object.freeze([...(HOTKEYS_BY_PLATFORM[platform] ?? HOTKEYS_BY_PLATFORM.darwin)]);

export const HOTKEY_IDS = hotkeyIdsFor(process.platform);

/** 热键叫什么：一句还没定语言的话 */
export const hotkeyName = (id) => msg(`hotkeys.${id}.name`);
/** 热键写在悬浮条提示里的短名字（那里地方小） */
export const hotkeyKeycap = (id) => msg(`hotkeys.${id}.keycap`);

const THEME_IDS = THEMES.map((theme) => theme.id);
const MODE_IDS = MODES.map((mode) => mode.id);
const TRANSCRIBER_IDS = MODELS.map((model) => model.id);
/** 第一跳能填的：本机模型的 id，和云端清单里的 厂商/模型（清单外的云端模型名也认，见 transcriber.parse） */
const TRANSCRIBER_CHOICES = [
  ...TRANSCRIBER_IDS,
  ...CLOUD_TRANSCRIBERS.flatMap((vendor) => vendor.models.map((model) => `${vendor.id}/${model.id}`)),
];
/** 云端模型名里只出现这些字符（qwen3-asr-flash、fun-asr-flash-2026-06-15） */
const CLOUD_MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const SOURCE_IDS = SOURCES.map((source) => source.id);
/** 本机模型用不用显卡：auto 有显卡就用、在显卡上没装起来就退回 CPU（asr/start.mjs）；cpu 只用 CPU */
export const ACCELERATIONS = Object.freeze(["auto", "cpu"]);
const THINKING_LEVELS = findProvider("gemini").thinkingLevels;
const LANGUAGES = [SYSTEM_LOCALE, ...LOCALES.map(({ id }) => id)];

const oneOf = (choices) => new LocalizedError(msg("settings.oneOf", { choices: choices.join(" / ") }));

/**
 * 每一项：对应的环境变量、默认值、能填的值（不限时为 null）、把写法规整并校验的函数。
 * 这一项是做什么的写在文案里（settings.describe.<名字>），按界面语言写。
 * label 可有可无：值本身不好懂时（right_option、cinnabar）给出它叫什么，是一句话（msg）或者一个名字。
 * legacyEnv 可有可无：改名之前的环境变量，env 没设时照样认（README 里写过，用的人可能还在用）。
 * store 可有可无：规整后的值写进文件时换成什么样子（默认原样）。
 * ofMode 可有可无：这一项属于哪种识别模式（server/modes.mjs），只在那种模式里能换（app/modes.mjs）。
 *   local 的两跳各有各的：transcriber 是第一跳（本机模型或云端模型），polish 和 customUrl 是第二跳。
 *   private（数据隐私）只有一跳：privateTranscriber，只能是本机模型；和 local 的第一跳分开存，各换各的。
 */
export const SETTINGS = {
  hotkey: {
    env: "SPEAKMORE_HOTKEY",
    default: HOTKEY_IDS[0],
    choices: HOTKEY_IDS,
    parse(value) {
      if (!HOTKEY_IDS.includes(value)) throw oneOf(HOTKEY_IDS);
      return value;
    },
    label: hotkeyName,
  },
  mode: {
    env: "SPEAKMORE_MODE",
    // 两条链路平级（server/modes.mjs）。原生是 0.6 以前唯一的一条，没选过的人照旧
    default: DEFAULT_MODE,
    choices: MODE_IDS,
    parse: parseMode,
    label: (value) => msg(`modes.${value}`),
  },
  model: {
    ofMode: "native",
    env: "SPEAKMORE_MODEL",
    // 0.3 以前只有 Gemini，这个环境变量只写模型名
    legacyEnv: "GEMINI_MODEL",
    default: formatModelChoice(DEFAULT_MODEL_CHOICE),
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
    ofMode: "native",
    env: "GEMINI_THINKING_LEVEL",
    default: DEFAULT_THINKING_LEVEL,
    choices: THINKING_LEVELS,
    parse(value) {
      const level = value.toUpperCase();
      if (!THINKING_LEVELS.includes(level)) throw oneOf(THINKING_LEVELS);
      return level;
    },
  },
  transcriber: {
    ofMode: "local",
    env: "SPEAKMORE_TRANSCRIBER",
    default: DEFAULT_TRANSCRIBER,
    choices: TRANSCRIBER_CHOICES,
    // 本机模型写 id；云端模型写 厂商/模型（只写厂商用它的默认模型），存下来的统一是 厂商/模型
    parse(value) {
      const id = value.trim();
      const cloud = cloudTranscriberOf(id);
      if (cloud) {
        if (!CLOUD_MODEL_NAME.test(cloud.model))
          throw new LocalizedError(msg("chat.badModelName", { model: JSON.stringify(cloud.model) }));
        return `${cloud.vendor}/${cloud.model}`;
      }
      if (!TRANSCRIBER_IDS.includes(id)) throw oneOf(TRANSCRIBER_CHOICES);
      return id;
    },
  },
  privateTranscriber: {
    ofMode: "private",
    env: "SPEAKMORE_PRIVATE_TRANSCRIBER",
    default: DEFAULT_TRANSCRIBER,
    // 数据隐私模式什么都不上传：只认本机模型
    choices: TRANSCRIBER_IDS,
    parse(value) {
      const id = value.trim();
      if (!TRANSCRIBER_IDS.includes(id)) throw oneOf(TRANSCRIBER_IDS);
      return id;
    },
  },
  polish: {
    ofMode: "local",
    env: "SPEAKMORE_POLISH",
    default: formatChatChoice(parseChatChoice(DEFAULT_POLISH)),
    choices: null,
    // 存下来的统一是 厂商/模型
    parse: (value) => formatChatChoice(parseChatChoice(value)),
  },
  customUrl: {
    ofMode: "local",
    env: "SPEAKMORE_CUSTOM_URL",
    // 空的是没填：只有润色交给自定义服务时才要
    default: "",
    choices: null,
    parse: (value) => (value.trim() === "" ? "" : normalizeBaseUrl(value)),
  },
  modelSource: {
    // 本地模型没下载过时先从哪下，哪种模式里都能改（切到 local 之前先选好）。选的那个下不动会换另一个，只影响快慢
    env: "SPEAKMORE_MODEL_SOURCE",
    default: DEFAULT_SOURCE,
    choices: SOURCE_IDS,
    parse(value) {
      const id = value.trim().toLowerCase();
      if (!SOURCE_IDS.includes(id)) throw oneOf(SOURCE_IDS);
      return id;
    },
    label: (value) => msg(`modelSources.${value}`),
  },
  acceleration: {
    // 显卡驱动有问题、或者想把显卡让给游戏时选 cpu。换了要重新装一次模型，App 里当场换
    env: "SPEAKMORE_ACCELERATION",
    default: "auto",
    choices: ACCELERATIONS,
    parse(value) {
      const id = value.trim().toLowerCase();
      if (!ACCELERATIONS.includes(id)) throw oneOf(ACCELERATIONS);
      return id;
    },
    label: (value) => msg(`accelerations.${value}`),
  },
  theme: {
    env: "SPEAKMORE_THEME",
    default: DEFAULT_THEME,
    choices: THEME_IDS,
    parse(value) {
      // 写 id 或写名字都认（cinnabar、朱砂、Cinnabar），存下来的统一是 id
      const theme = findTheme(value.trim());
      if (theme === null) throw oneOf(THEME_IDS);
      return theme.id;
    },
    label: (value) => msg(`themes.${value}.name`),
  },
  language: {
    env: "SPEAKMORE_LANGUAGE",
    // 跟随系统，认不出系统的语言时用英文（src/i18n）
    default: SYSTEM_LOCALE,
    choices: LANGUAGES,
    parse(value) {
      const wanted = value.trim();
      if (wanted.toLowerCase() === SYSTEM_LOCALE) return SYSTEM_LOCALE;
      const locale = findLocale(wanted);
      if (locale === null) throw oneOf(LANGUAGES);
      return locale.id;
    },
    // 语言的名字用它自己的语言写（English、简体中文），不翻
    label: (value) => (value === SYSTEM_LOCALE ? msg("language.system") : findLocale(value).name),
  },
};

function settingNamed(name) {
  if (!Object.hasOwn(SETTINGS, name)) {
    throw new LocalizedError(
      msg("settings.unknown", { name: JSON.stringify(name), names: Object.keys(SETTINGS).join(" / ") }),
    );
  }
  return SETTINGS[name];
}

/** @param {string | object} where 哪里写的：设置的名字，或者一句话（msg） */
function parseValue(name, value, where) {
  try {
    if (typeof value !== "string") throw new LocalizedError(msg("settings.notText"));
    return SETTINGS[name].parse(value);
  } catch (error) {
    throw new LocalizedError(
      msg("settings.invalid", { where, value: JSON.stringify(value), reason: problemOf(error) }),
      {
        cause: error,
      },
    );
  }
}

function readFile(file) {
  if (!existsSync(file)) return {};
  let stored;
  try {
    stored = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new LocalizedError(msg("settings.unreadable", { file, reason: error.message }), { cause: error });
  }
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    throw new LocalizedError(msg("settings.notObject", { file }));
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
      const value = parseValue(name, env[variable], msg("settings.whereEnv", { variable }));
      resolved[name] = variable === setting.env ? { value, source: "env" } : { value, source: "env", env: variable };
    } else if (stored[name] !== undefined) {
      resolved[name] = {
        value: parseValue(name, stored[name], msg("settings.whereFile", { file, name })),
        source: "file",
      };
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

/**
 * 按要改的几项拼出改后的设置，不写文件：先看改了之后走哪条路线、验证过了再存的时候用。
 * 写错了照 saveSetting 的规矩报错
 * @param {ReturnType<typeof resolveSettings>} settings
 * @param {Record<string, string>} changes
 */
export function patchSettings(settings, changes) {
  const patched = { ...settings };
  for (const [name, value] of Object.entries(changes)) {
    settingNamed(name);
    patched[name] = { value: parseValue(name, value, name), source: "file" };
  }
  return patched;
}

/** 每种模式自己的那几项设置（ofMode） */
export const MODE_SETTINGS = Object.freeze(
  Object.fromEntries(
    MODE_IDS.map((mode) => [mode, Object.keys(SETTINGS).filter((name) => SETTINGS[name].ofMode === mode)]),
  ),
);

/**
 * 每种模式由哪几项设置拼成路线（server/modes.mjs）。各看各的：改了 local 的润色，native 的路线不变
 */
const ROUTES = {
  native: (settings) => ({
    mode: "native",
    model: parseModelChoice(settings.model.value),
    thinkingLevel: settings.thinking.value,
  }),
  local: (settings) => ({
    mode: "local",
    transcriber: settings.transcriber.value,
    polish: parseChatChoice(settings.polish.value),
    customUrl: settings.customUrl.value || null,
  }),
  private: (settings) => ({ mode: "private", transcriber: settings.privateTranscriber.value }),
};

/**
 * 某种模式按现在的设置走哪条路线，不写就是设置里选的那种模式
 * @param {ReturnType<typeof resolveSettings>} settings
 * @param {string} [mode]
 */
export function routeOf(settings, mode = settings.mode.value) {
  return ROUTES[mode](settings);
}
