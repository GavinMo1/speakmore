import { apiKeyProblem } from "../server/config.mjs";
import { describeKeyError } from "./service.mjs";

const MISSING = { state: "missing", source: null, problem: null };

/**
 * 这次运行用哪把 key、它现在是什么状态。启动时去哪找、设置窗口和 speakmore key 来换、来删，都走这里。
 *
 * 状态（current）里的几项：
 *   state     missing（没有）/ unreadable（存着但解不开）/ checking / rejected / ready
 *   source    env（环境变量 GEMINI_API_KEY）/ stored（加密存着的）/ external（key 在单独启动的服务端那边）
 *   problem   给用户看的一句原因
 *   cause     只在 rejected 时有：key（这把 key 不对）/ other（Gemini 拒绝了请求，多半是模型名或思考档位）
 *   verified  只在 ready 时有：false 表示启动时够不着 Gemini（没网，或者它一时不可用），先用着，还没验证
 *
 * @param {object} options
 * @param {{ useKey: Function, verify: Function, forgetKey: Function } | null} options.service
 *   内置的听写服务；连的是单独启动的服务端时为 null，key 归那边管
 * @param {{ load(): string | null, save(key: string): void, clear(): void }} options.keyStore
 * @param {Record<string, string | undefined>} options.env
 * @param {{ info: Function, error: Function }} options.log
 * @param {() => void} options.onChange 状态每变一次调一次
 */
export function createKeyManager({ service, keyStore, env, log, onChange }) {
  let current = MISSING;
  /** 验证一把 key 要等 Gemini 回话。前一把还没验完又来一把时排队，免得先来的后到、把后来的盖掉 */
  let queue = Promise.resolve();
  let reverifying = false;

  function become(next) {
    current = next;
    onChange();
    return current;
  }

  function reject(source, cause, problem, detail) {
    // detail 是抹掉 key 之后的报错原文
    log.error("key_rejected", { source, cause, error: detail.slice(0, 300) });
    return become({ state: "rejected", source, problem, cause });
  }

  /**
   * 拿一把 key 去验证，通过了才开始用。不抛错。
   * @param {{ atStartup: boolean }} options 两处不一样：启动时只是够不着 Gemini 的话照样启用，没通过就是不能用；
   *   换一把时够不着也算没通过，没通过的话服务里原来那把还在用，状态也回到原来的
   * @returns {Promise<null | { cause: string, problem: string }>} 通过了是 null，没通过是原因
   */
  function adopt(apiKey, source, { atStartup }) {
    const run = async () => {
      // 排到自己了再记"原来的状态"：排队期间前一把可能刚验完
      const previous = current;
      become({ state: "checking", source, problem: null });
      try {
        const { verified } = await service.useKey(apiKey, { allowUnverified: atStartup });
        log.info("key_ready", { source, verified });
        become({ state: "ready", source, problem: null, verified });
        return null;
      } catch (error) {
        const { cause, problem, detail } = describeKeyError(error, apiKey);
        if (atStartup) reject(source, cause, problem, detail);
        else {
          log.error("key_rejected", { source, cause, error: detail.slice(0, 300) });
          become(previous);
        }
        return { cause, problem };
      }
    };
    queue = queue.then(run);
    return queue;
  }

  return {
    get current() {
      return current;
    },

    /**
     * 启动时找 key：环境变量优先（从终端临时给一把时用），其次是存着的那把。
     * 只是够不着 Gemini 的话照样启用：存着的那把当初验证过才存的，不该因为开机时没网就让人重新填。
     */
    async loadAtStartup() {
      if (!service) return become({ state: "ready", source: "external", problem: null });

      let apiKey = env.GEMINI_API_KEY?.trim();
      let source = "env";
      if (!apiKey) {
        source = "stored";
        try {
          apiKey = keyStore.load();
        } catch (error) {
          // 换了签名或钥匙串里的密钥没了都会这样，只能请用户重新填
          log.error("key_unreadable", { error: String(error?.message ?? error) });
          return become({ state: "unreadable", source, problem: "存着的 key 读不出来了，重新填一次" });
        }
        if (!apiKey) return current;
      }
      const shape = apiKeyProblem(apiKey);
      if (shape) return reject(source, "key", `这把 key ${shape}`, "样子不对，没有拿去验证");
      await adopt(apiKey, source, { atStartup: true });
      return current;
    },

    /**
     * 验证并保存一把新的 key。没通过时原因在返回值里，原来的状态不变。
     * @returns {Promise<{ ok: true } | { ok: false, problem: string }>}
     */
    async save(value) {
      if (typeof value !== "string" || value.trim() === "") return { ok: false, problem: "还没有填 key" };
      if (!service) {
        return { ok: false, problem: "现在连的是单独启动的服务端（SPEAKMORE_SERVER_URL），key 在那边配" };
      }
      const apiKey = value.trim();
      const shape = apiKeyProblem(apiKey);
      if (shape) return { ok: false, problem: `这把 key ${shape}` };

      const failure = await adopt(apiKey, "stored", { atStartup: false });
      if (failure) return { ok: false, problem: failure.problem };
      try {
        keyStore.save(apiKey);
      } catch (error) {
        // 验证过了但存不下来：这次运行照样能用，下次启动要重填，如实告诉用户
        log.error("key_save_failed", { error: String(error?.message ?? error) });
        return { ok: false, problem: `key 能用，但没存下来（${error.message}），退出后要重新填` };
      }
      return { ok: true };
    },

    forget() {
      keyStore.clear();
      log.info("key_forgotten");
      if (!service) return;
      service.forgetKey();
      become(MISSING);
    },

    /** 启动时够不着 Gemini、还没验证的那把，再验一次。别的情况什么都不做 */
    async reverify() {
      const checked = current;
      if (reverifying || checked.state !== "ready" || checked.verified !== false) return;
      reverifying = true;
      try {
        await service.verify();
        if (current !== checked) return;
        log.info("key_ready", { source: checked.source, verified: true });
        become({ ...checked, verified: true });
      } catch (error) {
        const { cause, problem, detail } = describeKeyError(error);
        // 还是够不着就继续先用着；期间状态被别处换过（比如存了一把新的）也不再插手
        if (cause === "unavailable" || current !== checked) return;
        service.forgetKey();
        reject(checked.source, cause, problem, detail);
      } finally {
        reverifying = false;
      }
    },
  };
}
