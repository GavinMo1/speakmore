// 内置的听写服务：就是 ../server 那个服务端，跑在主进程里，这样用的人不用另开一个终端。
// 页面和它之间仍然走 WebSocket，服务端照旧可以单独启动（调试、回放录音、评估提示词）。
import { findProvider } from "../server/providers/index.mjs";
import { createModelRefiner } from "../server/refine/refiner.mjs";
import { startServer, WS_PATH } from "../server/server.mjs";

/**
 * 启动内置服务。端口由系统分配，所以不会和别的程序（或单独启动的服务端）抢端口。
 * 没有 key 时服务照样在听，只是每次整理都会失败并说明原因；这样页面连的地址始终不变，填了 key 立刻能用。
 *
 * @param {object} options
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 * @param {{ provider: string, model: string }} options.model 用哪一家的哪个模型（设置里的 model）
 * @param {string} [options.thinkingLevel] 只有 Gemini 用得上
 * @param {typeof createModelRefiner} [options.createRefiner] 测试时换成假的
 */
export async function startService({ log, model, thinkingLevel, createRefiner = createModelRefiner }) {
  const provider = findProvider(model.provider);
  const noKeyMessage = `还没有填 ${provider.name} API key：在终端运行 speakmore key，或者点菜单栏的“听写”打开设置`;
  /** 通过了验证、正在用的那一个；没有 key 时是 null */
  let refiner = null;

  const server = await startServer({
    port: 0,
    log,
    refiner: {
      async refine(audio, options) {
        if (!refiner) throw new Error(noKeyMessage);
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
     * 换一把 key。先拿它发一个最小的请求：key 无效、模型名写错、连不上都会在这里抛出来（都是分好类的
     * ModelError），这时原来能用的那把继续用。这个请求同时是预热，之后的第一次听写不会慢。
     *
     * @param {string} apiKey
     * @param {{ allowUnverified?: boolean }} [options] allowUnverified：只是暂时够不着那一家的话照样启用。
     *   启动时用：存着的那把当初是验证过才存的，不该因为开机时没网、或者对方一时回了 503 就被判成不能用
     * @returns {Promise<{ verified: boolean }>} verified 为 false 表示先用着、还没验证
     */
    async useKey(apiKey, { allowUnverified = false } = {}) {
      const candidate = await createRefiner({ choice: model, apiKey, thinkingLevel, log });
      let verified = true;
      try {
        await candidate.warmUp();
      } catch (error) {
        if (!allowUnverified || error.kind !== "unavailable") throw error;
        verified = false;
      }
      refiner = candidate;
      return { verified };
    },

    /** 把正在用的那把再验一次，没通过就抛错。启动时没连上网的，之后靠它补上验证 */
    async verify() {
      if (!refiner) throw new Error(noKeyMessage);
      await refiner.warmUp();
    },

    /**
     * 拿一把 key 试某一家的某个模型，不换掉正在用的：给别家存 key 前验证、speakmore model check 都用它。
     * @param {{ choice: { provider: string, model: string }, apiKey: string }} options
     */
    async probe({ choice, apiKey }) {
      const candidate = await createRefiner({ choice, apiKey, thinkingLevel, log });
      await candidate.warmUp();
    },

    forgetKey() {
      refiner = null;
    },

    close: () => server.close(),
  };
}
