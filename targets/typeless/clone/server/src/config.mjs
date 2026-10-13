const THINKING_LEVELS = ["MINIMAL", "LOW", "MEDIUM", "HIGH"];

/**
 * 从环境变量读配置。写错了就报错退出，不悄悄换成默认值。
 * 默认模型和思考档位是实测选的：gemini-3.5-flash + MINIMAL 约 1.7 秒出结果，能处理改口；
 * flash-lite 更快（约 1.2 秒）但会把改口的痕迹留下。有的型号不接受 MINIMAL，所以档位也要能换。
 */
export function loadConfig(env) {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("缺少环境变量 GEMINI_API_KEY。用按需加载器只喂给这一个进程，例如：withkey <凭据名> npm start");
  }

  const port = env.PORT === undefined ? 8790 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 要是 1–65535 的整数，现在是 ${JSON.stringify(env.PORT)}`);
  }

  const thinkingLevel = (env.GEMINI_THINKING_LEVEL ?? "MINIMAL").toUpperCase();
  if (!THINKING_LEVELS.includes(thinkingLevel)) {
    throw new Error(
      `GEMINI_THINKING_LEVEL 要是 ${THINKING_LEVELS.join(" / ")} 之一，现在是 ${JSON.stringify(env.GEMINI_THINKING_LEVEL)}`,
    );
  }

  return {
    // 只监听本机：这个服务没有登录，不该被局域网里的其他机器连到
    host: "127.0.0.1",
    port,
    gemini: { apiKey, model: env.GEMINI_MODEL?.trim() || "gemini-3.5-flash", thinkingLevel, timeoutMs: 30_000 },
  };
}
