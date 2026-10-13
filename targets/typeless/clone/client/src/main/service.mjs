// 应用内置的听写服务：就是 ../server 那个服务端，跑在主进程里，这样用的人不用另开一个终端。
// 客户端和服务端仍然是两个包、之间仍然走 WebSocket，服务端照旧可以单独启动（调试、回放录音、评估提示词）。
// 打包后服务端被放在应用的 Resources/server，和这里的相对位置不变（见 scripts/package.mjs）。
import { loadConfig } from "../../../server/src/config.mjs";
import { createGeminiRefiner } from "../../../server/src/refiner.mjs";
import { startServer, WS_PATH } from "../../../server/src/server.mjs";

const NO_KEY_MESSAGE = "还没有填 Gemini API key：点菜单栏的“听写”，打开设置填上";

/**
 * 启动内置服务。端口由系统分配，所以不会和别的程序（或单独启动的服务端）抢端口。
 * 没有 key 时服务照样在听，只是每次整理都会失败并说明原因；这样页面连的地址始终不变，填了 key 立刻能用。
 *
 * @param {object} options
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 * @param {(options: object) => { warmUp(): Promise<void>, refine: Function }} [options.createRefiner] 测试时换成假的
 */
export async function startService({ log, createRefiner = createGeminiRefiner }) {
  /** 通过了验证、正在用的那一个；没有 key 时是 null */
  let refiner = null;

  const server = await startServer({
    port: 0,
    log,
    refiner: {
      async refine(audio, options) {
        if (!refiner) throw new Error(NO_KEY_MESSAGE);
        return refiner.refine(audio, options);
      },
    },
  });

  return {
    url: `ws://127.0.0.1:${server.port}${WS_PATH}`,

    get ready() {
      return refiner !== null;
    },

    /**
     * 换一把 key。先拿它发一个最小的请求：key 无效、模型名写错、连不上都会在这里抛出来，
     * 这时原来能用的那把继续用。这个请求同时是预热，之后的第一次听写不会慢。
     */
    async useKey(apiKey) {
      // 模型和思考档位仍然可以用环境变量换，校验规则和单独启动服务端时是同一套
      const { gemini } = loadConfig({
        GEMINI_API_KEY: apiKey,
        GEMINI_MODEL: process.env.GEMINI_MODEL,
        GEMINI_THINKING_LEVEL: process.env.GEMINI_THINKING_LEVEL,
      });
      const candidate = createRefiner({ ...gemini, log });
      await candidate.warmUp();
      refiner = candidate;
    },

    forgetKey() {
      refiner = null;
    },

    close: () => server.close(),
  };
}

/** useKey 抛出的错误 → 给用户看的一句话。前两种是拿假 key 和超时实测到的 */
export function describeKeyError(error) {
  const message = String(error?.message ?? error);
  if (/API key not valid|API_KEY_INVALID/.test(message)) return "这把 key 无效，检查有没有复制完整";
  if (error?.name === "AbortError" || error?.name === "TimeoutError" || /fetch failed/.test(message)) {
    return "连不上 Gemini，检查网络后再试";
  }
  return message.slice(0, 200);
}
