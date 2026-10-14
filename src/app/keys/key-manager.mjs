import { toModelError } from "../../server/providers/errors.mjs";
import { apiKeyProblem, findProvider } from "../../server/providers/index.mjs";

const MISSING = { state: "missing", source: null, problem: null };

/**
 * 每家模型各有一把 key。这次运行用的是哪一家（provider）由设置定，它的那把 key 现在是什么状态、
 * 启动时去哪找、怎么换、怎么删，都走这里；别家的 key 也在这里存、删、拿去检查，但不影响正在用的。
 *
 * 状态（current，只说正在用的那一家）里的几项：
 *   state     missing（没有）/ unreadable（存着但解不开）/ checking / rejected / ready
 *   source    env（环境变量，比如 GEMINI_API_KEY）/ stored（加密存着的）/ external（key 在单独启动的服务端那边）
 *   problem   给用户看的一句原因
 *   cause     只在 rejected 时有：key（这把 key 不对）/ other（那一家拒绝了请求，多半是模型名或思考档位）
 *   verified  只在 ready 时有：false 表示启动时够不着那一家（没网，或者它一时不可用），先用着，还没验证
 *
 * @param {object} options
 * @param {{ useKey: Function, verify: Function, forgetKey: Function, probe: Function } | null} options.service
 *   内置的听写服务；连的是单独启动的服务端时为 null，key 归那边管
 * @param {{ id: string, name: string, keyEnv: string }} options.provider 正在用的那一家（providers/index.mjs）
 * @param {Record<string, { load(): string | null, save(key: string): void, clear(): void }>} options.keyStores
 *   每家一个，按 id 找
 * @param {Record<string, string | undefined>} options.env
 * @param {{ info: Function, error: Function }} options.log
 * @param {() => void} options.onChange 状态每变一次调一次
 */
export function createKeyManager({ service, provider, keyStores, env, log, onChange }) {
  let current = MISSING;
  /** 排在最后的那件事做完的时候。只用来排队，不带结果也不带错误 */
  let queue = Promise.resolve();
  let reverifying = false;

  /**
   * 换 key、删 key 一件一件来。验证一把 key 要等那一家回话，这期间又来一件的话排在后面：
   * 否则先来的后到，会把后来的盖掉（比如验证途中点了删除，验证回来又把它启用了）。
   */
  function enqueue(task) {
    const result = queue.then(task);
    // 一件事出了错由它自己的调用方处理，不连累排在后面的
    queue = result.catch(() => {});
    return result;
  }

  function become(next) {
    current = next;
    onChange();
    return current;
  }

  /** 服务报上来的错。不是模型层分好类的（多半是 bug）也照样能说，key 先抹掉 */
  const described = (error, apiKey) => {
    const modelError = toModelError(error, { provider, apiKey });
    return { cause: modelError.kind, problem: modelError.message, detail: modelError.detail };
  };

  function reject(source, cause, problem, detail) {
    // detail 是抹掉 key 之后的报错原文
    log.error("key_rejected", { provider: provider.id, source, cause, error: detail.slice(0, 300) });
    return become({ state: "rejected", source, problem, cause });
  }

  /** 按 id 找到那一家和它的 key 存放处。不认识就抛错 */
  function lookup(id) {
    const found = findProvider(id);
    if (!found || !keyStores[found.id]) throw new Error(`不认识 ${id} 这家模型厂商`);
    return { found, store: keyStores[found.id] };
  }

  /**
   * 拿一把 key 去验证，通过了才开始用。不抛错。
   * @param {{ atStartup: boolean }} options 两处不一样：启动时只是够不着的话照样启用，没通过就是不能用；
   *   换一把时够不着也算没通过，没通过的话服务里原来那把还在用，状态也回到原来的
   * @returns {Promise<null | { cause: string, problem: string }>} 通过了是 null，没通过是原因
   */
  function adopt(apiKey, source, { atStartup }) {
    return enqueue(async () => {
      // 排到自己了再记"原来的状态"：排队期间前一把可能刚验完
      const previous = current;
      become({ state: "checking", source, problem: null });
      try {
        const { verified } = await service.useKey(apiKey, { allowUnverified: atStartup });
        log.info("key_ready", { provider: provider.id, source, verified });
        become({ state: "ready", source, problem: null, verified });
        return null;
      } catch (error) {
        const { cause, problem, detail } = described(error, apiKey);
        if (atStartup) reject(source, cause, problem, detail);
        else {
          log.error("key_rejected", { provider: provider.id, source, cause, error: detail.slice(0, 300) });
          become(previous);
        }
        return { cause, problem };
      }
    });
  }

  /** 给不是正在用的那一家存 key：用它的默认模型验证一次，通过了再存。不碰正在用的 */
  function saveForOther(found, store, apiKey) {
    return enqueue(async () => {
      try {
        await service.probe({ choice: { provider: found.id, model: found.defaultModel }, apiKey });
      } catch (error) {
        const { cause, problem, detail } = described(error, apiKey);
        log.error("key_rejected", { provider: found.id, source: "stored", cause, error: detail.slice(0, 300) });
        return { ok: false, problem };
      }
      return storeKey(store, apiKey);
    });
  }

  function storeKey(store, apiKey) {
    try {
      store.save(apiKey);
    } catch (error) {
      // 验证过了但存不下来：正在用的话这次运行照样能用，下次启动要重填，如实告诉用户
      log.error("key_save_failed", { error: String(error?.message ?? error) });
      return { ok: false, problem: `key 能用，但没存下来（${error.message}），退出后要重新填` };
    }
    return { ok: true };
  }

  /** 那一家这次该用哪把 key：环境变量优先（从终端临时给一把时用），其次是存着的。读不出来会抛错 */
  function keyFor(found, store) {
    const fromEnv = env[found.keyEnv]?.trim();
    if (fromEnv) return { apiKey: fromEnv, source: "env" };
    const stored = store.load();
    return stored ? { apiKey: stored, source: "stored" } : null;
  }

  return {
    get current() {
      return current;
    },

    /**
     * 启动时给正在用的那一家找 key。
     * 只是够不着的话照样启用：存着的那把当初验证过才存的，不该因为开机时没网就让人重新填。
     */
    async loadAtStartup() {
      if (!service) return become({ state: "ready", source: "external", problem: null });

      let found;
      try {
        found = keyFor(provider, keyStores[provider.id]);
      } catch (error) {
        // 换了签名或钥匙串里的密钥没了都会这样，只能请用户重新填
        log.error("key_unreadable", { provider: provider.id, error: String(error?.message ?? error) });
        return become({ state: "unreadable", source: "stored", problem: "存着的 key 读不出来了，重新填一次" });
      }
      if (!found) return current;
      const { apiKey, source } = found;
      const shape = apiKeyProblem(apiKey);
      if (shape) return reject(source, "key", `这把 key ${shape}`, "样子不对，没有拿去验证");
      await adopt(apiKey, source, { atStartup: true });
      return current;
    },

    /**
     * 验证并保存一把新的 key。没通过时原因在返回值里，原来的状态不变。
     * @param {unknown} value
     * @param {{ provider?: string }} [options] 给哪一家存，默认是正在用的那一家
     * @returns {Promise<{ ok: true } | { ok: false, problem: string }>}
     */
    async save(value, { provider: id = provider.id } = {}) {
      if (typeof value !== "string" || value.trim() === "") return { ok: false, problem: "还没有填 key" };
      if (!service) {
        return { ok: false, problem: "现在连的是单独启动的服务端（SPEAKMORE_SERVER_URL），key 在那边配" };
      }
      let target;
      try {
        target = lookup(id);
      } catch (error) {
        return { ok: false, problem: error.message };
      }
      const apiKey = value.trim();
      const shape = apiKeyProblem(apiKey);
      if (shape) return { ok: false, problem: `这把 key ${shape}` };

      if (target.found.id !== provider.id) return saveForOther(target.found, target.store, apiKey);
      const failure = await adopt(apiKey, "stored", { atStartup: false });
      if (failure) return { ok: false, problem: failure.problem };
      return storeKey(target.store, apiKey);
    },

    /** @param {{ provider?: string }} [options] 删哪一家的，默认是正在用的那一家 */
    forget({ provider: id = provider.id } = {}) {
      return enqueue(() => {
        const { found, store } = lookup(id);
        store.clear();
        log.info("key_forgotten", { provider: found.id });
        if (!service || found.id !== provider.id) return;
        service.forgetKey();
        become(MISSING);
      });
    },

    /**
     * 某一家的某个模型现在能不能用：拿那一家的 key 发一个最小的请求。不抛错，不改变正在用的。
     * @param {{ provider: string, model: string }} choice
     * @returns {Promise<{ ok: true, source: string, ms: number } | { ok: false, cause: string, problem: string }>}
     *   cause：missing（没有这家的 key）/ unreadable / key / unavailable / other
     */
    async check(choice) {
      if (!service) {
        return {
          ok: false,
          cause: "other",
          problem: "现在连的是单独启动的服务端（SPEAKMORE_SERVER_URL），用哪个模型由那边定",
        };
      }
      let target;
      try {
        target = lookup(choice.provider);
      } catch (error) {
        return { ok: false, cause: "other", problem: error.message };
      }
      const { found, store } = target;
      let key;
      try {
        key = keyFor(found, store);
      } catch (error) {
        log.error("key_unreadable", { provider: found.id, error: String(error?.message ?? error) });
        return { ok: false, cause: "unreadable", problem: `存着的 ${found.name} key 读不出来了，重新填一次` };
      }
      if (!key) {
        return {
          ok: false,
          cause: "missing",
          problem: `还没有 ${found.name} 的 key：运行 speakmore key ${found.id}`,
        };
      }
      const shape = apiKeyProblem(key.apiKey);
      if (shape) return { ok: false, cause: "key", problem: `这把 key ${shape}` };
      const startedAt = performance.now();
      try {
        await service.probe({ choice, apiKey: key.apiKey });
      } catch (error) {
        const { cause, problem, detail } = described(error, key.apiKey);
        log.warn("model_check_failed", { provider: found.id, model: choice.model, cause, error: detail.slice(0, 300) });
        return { ok: false, cause, problem };
      }
      const ms = Math.round(performance.now() - startedAt);
      log.info("model_checked", { provider: found.id, model: choice.model, source: key.source, ms });
      return { ok: true, source: key.source, ms };
    },

    /** 启动时够不着那一家、还没验证的那把，再验一次。别的情况什么都不做 */
    async reverify() {
      const checked = current;
      if (reverifying || checked.state !== "ready" || checked.verified !== false) return;
      reverifying = true;
      try {
        await service.verify();
        if (current !== checked) return;
        log.info("key_ready", { provider: provider.id, source: checked.source, verified: true });
        become({ ...checked, verified: true });
      } catch (error) {
        const { cause, problem, detail } = described(error);
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
