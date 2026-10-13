export const THINKING_LEVELS = ["MINIMAL", "LOW", "MEDIUM", "HIGH"];
// 默认模型和思考档位是实测选的：gemini-3.5-flash + MINIMAL 约 1.7 秒出结果，能处理改口；
// flash-lite 更快（约 1.2 秒）但会把改口的痕迹留下。有的型号不接受 MINIMAL，所以档位也要能换。
export const DEFAULT_MODEL = "gemini-3.5-flash";
export const DEFAULT_THINKING_LEVEL = "MINIMAL";

const MAX_KEY_LENGTH = 512;

/**
 * key 的样子对不对（不联网）。不对时返回一句接在"这把 key"后面的说明，句子里不带 key 本身。
 * 要在交给 SDK 之前拦下：带换行的 key 会让它报"Headers.append: "…" is an invalid header value"，
 * 引号里是整段输入（实测），这句报错再进日志和终端，key 就漏了。
 * @returns {string | null} 没问题时是 null
 */
export function apiKeyProblem(key) {
  if (key.length > MAX_KEY_LENGTH) return `太长了（${key.length} 个字符），像是复制错了东西`;
  if (/\s/.test(key)) return "里有空格或换行，像是多复制了别的内容";
  // 只该有看得见的英文字符：别的字符放不进请求头
  if (!/^[\x21-\x7e]+$/.test(key)) return "里有不该出现的字符，像是复制错了东西";
  return null;
}

/** 从环境变量读配置。写错了就报错退出，不悄悄换成默认值。 */
export function loadConfig(env) {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("缺少环境变量 GEMINI_API_KEY");
  }
  const keyProblem = apiKeyProblem(apiKey);
  if (keyProblem) throw new Error(`GEMINI_API_KEY ${keyProblem}`);

  const port = env.PORT === undefined ? 8790 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 要是 1–65535 的整数，现在是 ${JSON.stringify(env.PORT)}`);
  }

  const thinkingLevel = (env.GEMINI_THINKING_LEVEL ?? DEFAULT_THINKING_LEVEL).toUpperCase();
  if (!THINKING_LEVELS.includes(thinkingLevel)) {
    throw new Error(
      `GEMINI_THINKING_LEVEL 要是 ${THINKING_LEVELS.join(" / ")} 之一，现在是 ${JSON.stringify(env.GEMINI_THINKING_LEVEL)}`,
    );
  }

  return {
    // 只监听本机：这个服务没有登录，不该被局域网里的其他机器连到
    host: "127.0.0.1",
    port,
    gemini: { apiKey, model: env.GEMINI_MODEL?.trim() || DEFAULT_MODEL, thinkingLevel, timeoutMs: 30_000 },
  };
}
