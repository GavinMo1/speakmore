// 模型厂商的清单。录音交给哪一家整理是一个策略：每家一个适配器（同目录下的 gemini.mjs、openai.mjs），
// 各自管请求怎么拼、收哪些录音格式、报错怎么认；整理流程本身（提示词、收尾、重试）在 ../refine，各家共用。
//
// 这里只放每家的说明，不加载它的 SDK：命令行看设置、列模型时也要用到这份清单，不该为此把各家的代码都读进来。
// 真要发请求时再 load()。加一家 = 写一个适配器、在下面登记一行。

export const PROVIDERS = Object.freeze([
  Object.freeze({
    id: "gemini",
    name: "Gemini",
    keyEnv: "GEMINI_API_KEY",
    keyPage: "https://aistudio.google.com/apikey",
    keySite: "Google AI Studio",
    // 实测选的：gemini-3.5-flash + MINIMAL 约 1.7 秒出结果，能处理改口；flash-lite 更快（约 1.2 秒）但会把改口的痕迹留下
    defaultModel: "gemini-3.5-flash",
    // 有的型号不接受 MINIMAL，所以档位也要能换
    thinkingLevels: Object.freeze(["MINIMAL", "LOW", "MEDIUM", "HIGH"]),
    load: () => import("./gemini.mjs"),
  }),
  Object.freeze({
    id: "openai",
    name: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    keyPage: "https://platform.openai.com/api-keys",
    keySite: "OpenAI 开发者平台",
    defaultModel: "gpt-audio-mini",
    // gpt-audio 系列没有思考档位
    thinkingLevels: null,
    load: () => import("./openai.mjs"),
  }),
]);

export const DEFAULT_MODEL_CHOICE = Object.freeze({ provider: "gemini", model: PROVIDERS[0].defaultModel });
export const DEFAULT_THINKING_LEVEL = "MINIMAL";

/** @returns {(typeof PROVIDERS)[number] | null} 大小写不论；不认识的是 null */
export function findProvider(id) {
  const wanted = String(id).toLowerCase();
  return PROVIDERS.find((provider) => provider.id === wanted) ?? null;
}

/** 模型名里只出现这些字符（gpt-audio-1.5、gemini-3.5-flash、gpt-audio-mini-2025-12-15 这样的） */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
/** Gemini 的 SDK 还认带前缀的写法，0.3 时可能有人这么写在设置里 */
const GEMINI_PREFIXED = /^(models|tunedModels)\/[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/**
 * 用户写的模型选择 → { provider, model }。写法：
 *   openai/gpt-audio-1.5   厂商/模型
 *   openai                 只写厂商，用它的默认模型
 *   gemini-3.5-flash       只写一个不是厂商名的模型名：当成 Gemini 的。0.3 以前设置里只有 Gemini 的模型名，照样认
 *   models/gemini-3.5-flash  0.3 时 Gemini 的 SDK 也认带 models/、tunedModels/ 前缀的写法，照样认成 Gemini 的
 * 写错了就抛错，说清哪里不对。
 */
export function parseModelChoice(value) {
  const text = String(value ?? "").trim();
  if (text === "") throw new Error("是空的");
  if (GEMINI_PREFIXED.test(text)) return { provider: "gemini", model: text };
  const slash = text.indexOf("/");
  if (slash === -1) {
    const provider = findProvider(text);
    if (provider) return { provider: provider.id, model: provider.defaultModel };
    return { provider: "gemini", model: checkedModelName("gemini", text) };
  }
  const provider = findProvider(text.slice(0, slash));
  if (!provider) {
    throw new Error(`不认识 ${text.slice(0, slash)} 这家，能用的有 ${PROVIDERS.map(({ id }) => id).join(" / ")}`);
  }
  return { provider: provider.id, model: checkedModelName(provider.id, text.slice(slash + 1)) };
}

function checkedModelName(provider, model) {
  if (MODEL_NAME.test(model) || (provider === "gemini" && GEMINI_PREFIXED.test(model))) return model;
  throw new Error(`模型名 ${JSON.stringify(model)} 不对：只能有字母、数字和 . _ : -`);
}

export const formatModelChoice = ({ provider, model }) => `${provider}/${model}`;

const MAX_KEY_LENGTH = 512;

/**
 * key 的样子对不对（不联网）。不对时返回一句接在"这把 key"后面的说明，句子里不带 key 本身。
 * 要在交给 SDK 之前拦下：带换行的 key 会让 Gemini 的 SDK 报"Headers.append: "…" is an invalid header value"，
 * 引号里是整段输入（实测），这句报错再进日志和终端，key 就漏了。各家的 key 都放在请求头里，所以规则通用。
 * @returns {string | null} 没问题时是 null
 */
export function apiKeyProblem(key) {
  if (key.length > MAX_KEY_LENGTH) return `太长了（${key.length} 个字符），像是复制错了东西`;
  if (/\s/.test(key)) return "里有空格或换行，像是多复制了别的内容";
  // 只该有看得见的英文字符：别的字符放不进请求头
  if (!/^[\x21-\x7e]+$/.test(key)) return "里有不该出现的字符，像是复制错了东西";
  return null;
}
