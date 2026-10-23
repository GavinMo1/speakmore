import { LocalizedError } from "../../i18n/index.mjs";
import { createChatClient } from "../chat/client.mjs";
import { toModelError } from "../providers/errors.mjs";
import { createMeter } from "../refine/meter.mjs";
import { translationOf } from "./output.mjs";
import { fallbackOf, lookupInput, lookupPrompt } from "./prompt.mjs";
import { looksUntranslated, sourceIs } from "./source.mjs";

// 划词翻译：选中的字 → 译文。交给用户在引擎页"划词"那一段单独选的纯文字模型（和语音那边的整理模型毫不相干）。
// 怎么连、怎么记账、报错怎么认，和混合方式的整理那一步共用底层（../chat/client.mjs、../refine/meter.mjs）；
// 让模型做什么（提示词、收尾）在这个目录里，不引用语音那边的任务。每一笔记成 lookup，账和语音输入的分开数。

/** 一次请求最多等多久：选中的多半是一两句话，DeepSeek 关掉思考一秒上下；长段落留足余量 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * @param {object} options
 * @param {{ id: string, name: string }} options.endpoint 是哪一家
 * @param {{ ping(o: object): Promise<object>, complete(request: object): Promise<{ text: string | null, problem: object | null, usage: object }> }} options.client
 * @param {(error: unknown) => object | null} [options.classify] 这个协议的报错怎么认
 * @param {string} [options.apiKey] 只用来从报错里抹掉它
 * @param {(record: object) => void} [options.onCall] 记账，见 ../refine/meter.mjs
 * @returns {{ warmUp(): Promise<void>,
 *   translate(text: string, o: { language: object, lookupId: string, signal?: AbortSignal }): Promise<{ text: string, language: string }> }}
 *   出错时抛的都是 ModelError
 */
export function createTranslator({
  endpoint,
  client,
  classify,
  apiKey,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log,
  onCall = () => {},
}) {
  const described = (error) => toModelError(error, { provider: endpoint, apiKey, classify });
  const metered = createMeter({ provider: endpoint, log, onCall });
  const withTimeout = (signal) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  };

  return {
    /** 检查：发一个最小的请求，key、地址、模型名不对在这里就暴露 */
    async warmUp() {
      try {
        await metered("check", null, () => client.ping({ signal: AbortSignal.timeout(timeoutMs) }));
      } catch (error) {
        throw described(error);
      }
    },

    /**
     * 译成目标语言；选中的已经是目标语言时改译成另一种（prompt.mjs 的 fallbackOf）：认得出的直接改，
     * 认不出的、译回来和原文几乎一样的再译一遍（source.mjs）。两遍都记在这一次的 id 上
     * @param {string} text 选中的字
     * @param {{ language: { id: string, prompt: string }, lookupId: string, signal?: AbortSignal }} options
     *   language：目标语言（src/languages.mjs 的一项）；lookupId：这一次的 id，记账和历史按它对上
     * @returns {Promise<{ text: string, language: string }>} language 是实际译成的语言 id
     */
    async translate(text, { language, lookupId, signal }) {
      if (text.trim() === "") return { text: "", language: language.id };
      const once = async (target) => {
        const reply = await metered("lookup", lookupId, () =>
          client.complete({
            system: lookupPrompt(target),
            user: lookupInput(text, target),
            signal: withTimeout(signal),
          }),
        );
        if (reply.problem) throw new LocalizedError(reply.problem);
        return translationOf(reply.text, target);
      };
      try {
        const already = sourceIs(text, language.id);
        const target = already ? fallbackOf(language) : language;
        const translated = await once(target);
        if (already !== null || !looksUntranslated(text, translated)) return { text: translated, language: target.id };
        log.info("lookup_retargeted", { lookup_id: lookupId, from: language.id, to: fallbackOf(language).id });
        return { text: await once(fallbackOf(language)), language: fallbackOf(language).id };
      } catch (error) {
        throw described(error);
      }
    },
  };
}

/**
 * 按选的厂商和模型装出一个划词翻译器
 * @param {object} options 同 ../chat/client.mjs 的 createChatClient，另加 timeoutMs、log、onCall
 */
export async function createChatTranslator({ choice, customUrl, customParams, apiKey, timeoutMs, log, onCall, fetch }) {
  const { endpoint, client, classify } = await createChatClient({ choice, customUrl, customParams, apiKey, fetch });
  return createTranslator({ endpoint, client, classify, apiKey, timeoutMs, log, onCall });
}
