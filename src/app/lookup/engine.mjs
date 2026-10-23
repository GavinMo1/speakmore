import { LocalizedError, msg, problemOf } from "../../i18n/index.mjs";
import { findLanguage } from "../../languages.mjs";
import { createChatTranslator } from "../../server/lookup/translator.mjs";
import { lookupOf, patchSettings } from "../../storage/settings.mjs";

// 划词翻译交给谁：按设置里划词自己的那几项（storage/settings.mjs 的 lookupOf）装翻译器（server/lookup/translator.mjs）。
// key：选的是清单里的厂商时用那一家的 key，和语音那边同一把（同一家只有一把，app/keys/key-manager.mjs 的 keyOf）；
// 选自定义服务时用划词自己存的那一把，地址、参数也是划词自己的，和语音那边的自定义服务不相干（他定的）。
// 设置、key 每次现读：引擎页、设置页、命令行改了，下一次划词就按新的；没变时不重装。

/** 划词交给的那一家还缺什么。kind：missing 没有 key、unreadable 存着的解不开、setup 自定义服务没填地址 */
class LookupSetupError extends LocalizedError {
  constructor(problem, kind) {
    super(problem);
    this.kind = kind;
  }
}

/** 这一家叫什么（一句还没定语言的话）：自定义服务说它的地址的主机名，没填地址时叫"自定义服务" */
function nameOf({ choice, customUrl }) {
  if (choice.vendor !== "custom") return msg(`providers.${choice.vendor}.name`);
  return customUrl ? new URL(customUrl).host : msg("providers.custom.name");
}

/**
 * @param {object} options
 * @param {() => object} options.readSettings 现读设置（resolveSettings 的结果）
 * @param {(id: string) => { apiKey: string, source: string } | null} options.keyOf 清单里那一家的 key；解不开会抛错
 * @param {() => { apiKey: string, source: string } | null} options.customKey 划词自己的自定义服务的 key；解不开会抛错
 * @param {typeof createChatTranslator} [options.createTranslator] 测试时换成假的
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 * @param {(record: object) => void} options.onCall 记账（server/refine/meter.mjs）
 */
export function createLookupEngine({
  readSettings,
  keyOf,
  customKey,
  createTranslator = createChatTranslator,
  log,
  onCall,
}) {
  /** 装好的那一个：设置和 key 一样就接着用 */
  let cached = null;

  function keyFor(setup) {
    try {
      return setup.choice.vendor === "custom" ? customKey() : keyOf(setup.choice.vendor);
    } catch (error) {
      log.error("lookup_key_unreadable", { vendor: setup.choice.vendor, error: String(error?.message ?? error) });
      throw new LookupSetupError(msg("key.unreadableFor", { provider: nameOf(setup) }), "unreadable");
    }
  }

  /**
   * @param {object} setup lookupOf 的样子
   * @param {string} [candidate] 自定义服务还没存的那把 key（引擎页"划词"那一段先验再存）；选的不是自定义服务时不算数
   */
  function translatorFor(setup, candidate) {
    const key = candidate && setup.choice.vendor === "custom" ? { apiKey: candidate, source: "typed" } : keyFor(setup);
    if (!key) throw new LookupSetupError(msg("lookup.noKey", { provider: nameOf(setup) }), "missing");
    if (setup.choice.vendor === "custom" && !setup.customUrl) {
      throw new LookupSetupError(msg("lookup.customUrlMissing"), "setup");
    }
    const signature = JSON.stringify([setup.choice, setup.customUrl, setup.customParams, key.apiKey]);
    if (cached?.signature !== signature) {
      const ready = createTranslator({
        choice: setup.choice,
        customUrl: setup.customUrl,
        customParams: setup.customParams,
        apiKey: key.apiKey,
        log,
        onCall,
      });
      cached = { signature, ready };
      // 装不起来的不留着，下一次再装
      ready.catch(() => {
        if (cached?.ready === ready) cached = null;
      });
    }
    return cached.ready;
  }

  return {
    /** 现在的设置：译成哪种（to）、交给谁（choice）、自定义服务的地址和参数 */
    current: () => lookupOf(readSettings()),

    /**
     * @param {string} text 选中的字
     * @param {{ language: string, lookupId: string, signal?: AbortSignal }} options language 是语言 id
     * @returns {Promise<{ text: string, language: string }>} language 是实际译成的；出错时抛：缺东西是带 kind 的 LocalizedError，模型那边的是 ModelError（也带 kind）
     */
    async translate(text, { language, lookupId, signal }) {
      const translator = await translatorFor(lookupOf(readSettings()));
      return translator.translate(text, { language: findLanguage(language), lookupId, signal });
    },

    /**
     * 引擎页"划词"那一段的检查：按设置（再换上 changes 那几项）发一个最小的请求，不翻译
     * @param {Record<string, string>} [changes] 设置名 → 值，比如还没存的自定义服务地址
     * @param {{ apiKey?: string }} [options] apiKey：自定义服务还没存的那把 key
     * @returns {Promise<{ ok: true, ms: number } | { ok: false, cause: string, problem: object | string }>}
     */
    async check(changes = {}, { apiKey } = {}) {
      const startedAt = performance.now();
      try {
        const setup = lookupOf(patchSettings(readSettings(), changes));
        await (await translatorFor(setup, apiKey)).warmUp();
        return { ok: true, ms: Math.round(performance.now() - startedAt) };
      } catch (error) {
        log.warn("lookup_check_failed", { cause: error?.kind ?? "other", error: String(error?.message ?? error) });
        return { ok: false, cause: error?.kind ?? "other", problem: problemOf(error) };
      }
    },
  };
}
