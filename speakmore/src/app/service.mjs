// 内置的听写服务：就是 ../server 那个服务端，跑在主进程里，这样用的人不用另开一个终端。
// 页面和它之间仍然走 WebSocket，服务端照旧可以单独启动（调试、回放录音、评估提示词）。
import { loadConfig } from "../server/config.mjs";
import { createGeminiRefiner } from "../server/refiner.mjs";
import { startServer, WS_PATH } from "../server/server.mjs";

const NO_KEY_MESSAGE = "还没有填 Gemini API key：在终端运行 speakmore key，或者点菜单栏的“听写”打开设置";

/**
 * 启动内置服务。端口由系统分配，所以不会和别的程序（或单独启动的服务端）抢端口。
 * 没有 key 时服务照样在听，只是每次整理都会失败并说明原因；这样页面连的地址始终不变，填了 key 立刻能用。
 *
 * @param {object} options
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 * @param {string} [options.model] 不给就用服务端的默认值
 * @param {string} [options.thinkingLevel]
 * @param {(options: object) => { warmUp(): Promise<void>, refine: Function }} [options.createRefiner] 测试时换成假的
 */
export async function startService({ log, model, thinkingLevel, createRefiner = createGeminiRefiner }) {
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
     *
     * @param {string} apiKey
     * @param {{ allowUnverified?: boolean }} [options] allowUnverified：只是暂时够不着 Gemini 的话照样启用。
     *   启动时用：存着的那把当初是验证过才存的，不该因为开机时没网、或者 Gemini 一时回了 503 就被判成不能用
     * @returns {Promise<{ verified: boolean }>} verified 为 false 表示先用着、还没验证
     */
    async useKey(apiKey, { allowUnverified = false } = {}) {
      // 校验规则和超时与单独启动服务端时是同一套
      const { gemini } = loadConfig({
        GEMINI_API_KEY: apiKey,
        GEMINI_MODEL: model,
        GEMINI_THINKING_LEVEL: thinkingLevel,
      });
      const candidate = createRefiner({ ...gemini, log });
      let verified = true;
      try {
        await candidate.warmUp();
      } catch (error) {
        if (!allowUnverified || describeKeyError(error).cause !== "unavailable") throw error;
        verified = false;
      }
      refiner = candidate;
      return { verified };
    },

    /** 把正在用的那把再验一次，没通过就抛错。启动时没连上网的，之后靠它补上验证 */
    async verify() {
      if (!refiner) throw new Error(NO_KEY_MESSAGE);
      await refiner.warmUp();
    },

    forgetKey() {
      refiner = null;
    },

    close: () => server.close(),
  };
}

/** Gemini 的报错是一整段 JSON：{"error":{"code":503,"message":"…","status":"UNAVAILABLE"}}。不是这种形状时是 null */
function geminiError(message) {
  try {
    const { error } = JSON.parse(message);
    return typeof error?.message === "string" ? error : null;
  } catch {
    return null;
  }
}

/**
 * useKey / verify 抛出的错误是哪一种。下面认的几种报错都是实测到的：假 key、超时、写错的模型名、
 * Gemini 偶尔回的 503。
 *
 * @param {unknown} error
 * @param {string} [apiKey] 当时用的那把：报错里带着它的话先抹掉
 * @returns {{ cause: "key" | "unavailable" | "other", problem: string, detail: string }}
 *   cause：这把 key 不对 / 暂时够不着 Gemini（没网、超时、它那边出状况或限流），和 key、设置都没关系 /
 *   Gemini 拒绝了请求（多半是模型名或思考档位）；
 *   problem：给用户看的一句话，句尾不带标点；detail：抹掉 key 之后的原文，留给日志
 */
export function describeKeyError(error, apiKey) {
  let detail = String(error?.message ?? error);
  if (apiKey) detail = detail.replaceAll(apiKey, "（key）");
  if (/API key not valid|API_KEY_INVALID/.test(detail)) {
    return { cause: "key", problem: "这把 key 无效，检查有没有复制完整", detail };
  }
  if (error?.name === "AbortError" || error?.name === "TimeoutError" || /fetch failed/.test(detail)) {
    return { cause: "unavailable", problem: "连不上 Gemini，检查网络后再试", detail };
  }
  const gemini = geminiError(detail);
  if (gemini === null) return { cause: "other", problem: detail.slice(0, 200), detail };
  const said = gemini.message.replace(/[.。\s]+$/, "").slice(0, 160);
  if (gemini.code >= 500 || gemini.code === 429) {
    return { cause: "unavailable", problem: `Gemini 暂时用不了（${said}），过一会儿再试`, detail };
  }
  return { cause: "other", problem: `Gemini 拒绝了请求：${said}`, detail };
}
