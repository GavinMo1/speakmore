import {
  apiKeyProblem,
  DEFAULT_MODEL_CHOICE,
  DEFAULT_THINKING_LEVEL,
  findProvider,
  parseModelChoice,
} from "./providers/index.mjs";

// 单独启动服务端时（node src/server/main.mjs）从环境变量读配置。平时服务跑在后台应用里，设置走 src/storage/settings.mjs。

const THINKING_LEVELS = findProvider("gemini").thinkingLevels;

/** 选哪家哪个模型。SPEAKMORE_MODEL 优先；GEMINI_MODEL 是 0.3 以前的写法，只能写 Gemini 的模型名，照样认 */
function modelFrom(env) {
  for (const name of ["SPEAKMORE_MODEL", "GEMINI_MODEL"]) {
    if (env[name] === undefined) continue;
    try {
      return parseModelChoice(env[name]);
    } catch (error) {
      throw new Error(`${name} 写的是 ${JSON.stringify(env[name])}，${error.message}`);
    }
  }
  return DEFAULT_MODEL_CHOICE;
}

/** 从环境变量读配置。写错了就报错退出，不悄悄换成默认值。 */
export function loadConfig(env) {
  const model = modelFrom(env);
  const { keyEnv } = findProvider(model.provider);
  const apiKey = env[keyEnv]?.trim();
  if (!apiKey) throw new Error(`缺少环境变量 ${keyEnv}`);
  const keyProblem = apiKeyProblem(apiKey);
  if (keyProblem) throw new Error(`${keyEnv} ${keyProblem}`);

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

  // 只监听本机：这个服务没有登录，不该被局域网里的其他机器连到
  return { host: "127.0.0.1", port, model, apiKey, thinkingLevel };
}
