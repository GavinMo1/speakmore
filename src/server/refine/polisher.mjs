import { LocalizedError, msg } from "../../i18n/index.mjs";
import { fitTerms, PROMPT_VOCABULARY } from "../../vocabulary/support.mjs";
import { chatEndpoint, findChatVendor, PROTOCOLS, requestFor } from "../chat/vendors.mjs";
import { toModelError } from "../providers/errors.mjs";
import { createMeter } from "./meter.mjs";

// 整理：转出来的原文 → 成品。混合方式的第二步，交给哪一家的哪个纯文字模型由用户选（chat/vendors.mjs）。
// 让模型做什么（系统提示词、用户消息、成品怎么收）由每次交进来的任务定（../tasks，用它的 polish 那一副），
// 这里只管怎么交、怎么记账、出错怎么认。和直出的 refiner.mjs 是兄弟，记账（meter.mjs）共用。

/** 一次请求最多等多久。实测 DeepSeek 关掉思考后一两句话 0.7 秒，长段落几秒，留足余量 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * @param {object} options
 * @param {{ id: string, name: string }} options.endpoint 是哪一家（记账用 id，报错时称呼 name）
 * @param {{ ping(o: { signal: AbortSignal }): Promise<{ usage: object }>, complete(request: object): Promise<{ text: string | null, problem: object | null, usage: object }> }} options.client
 *   协议客户端（chat/openai-chat.mjs 的 createClient）
 * @param {(error: unknown, detail: string) => object | null} [options.classify] 这个协议的报错怎么认
 * @param {string} [options.apiKey] 只用来从报错里抹掉它
 * @param {(record: object) => void} [options.onCall] 记账，见 meter.mjs
 * @returns {{ warmUp(): Promise<void>,
 *   polish(transcript: string, o: { task: object, signal?: AbortSignal, audioId?: string, vocabulary?: readonly string[] }): Promise<{ text: string, source: string | null }> }}
 *   task 是定下了这一次做法的任务（../tasks 的 bind 回的）。出错时抛的都是 ModelError
 */
export function createPolisher({
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
    /** 启动、换 key 时发一个最小的请求：key、地址、模型名不对在这里就暴露，也让之后的第一次润色不慢 */
    async warmUp() {
      try {
        await metered("check", null, () => client.ping({ signal: AbortSignal.timeout(timeoutMs) }));
      } catch (error) {
        throw described(error);
      }
    },

    /**
     * @param {string} transcript 转出来的原文
     * @param {{ task: object, signal?: AbortSignal, audioId?: string, vocabulary?: readonly string[] }} options
     *   task：这一次的任务；vocabulary：用户词典，按先后（按大模型提示词的上限挑好，交给任务写进系统提示词）
     * @returns {Promise<{ text: string, source: string | null }>} 任务收好的成品；原文是空的、
     *   或者模型判断没有要输入的内容时 text 是空字符串
     */
    async polish(transcript, { task, signal, audioId = null, vocabulary = [] }) {
      // 没转出字（静音、只有噪声）就不必花这一次请求
      if (transcript.trim() === "") return { text: "", source: null };
      const terms = fitTerms(vocabulary, PROMPT_VOCABULARY);
      if (vocabulary.length > 0) {
        log.info("vocabulary_fitted", { audio_id: audioId, hop: "polish", sent: terms.length, of: vocabulary.length });
      }
      try {
        const reply = await metered("dictation", audioId, () =>
          client.complete({
            system: task.polish.system(terms),
            user: task.polish.input(transcript),
            signal: withTimeout(signal),
          }),
        );
        if (reply.problem) throw new LocalizedError(reply.problem);
        return task.polish.finish(reply.text ?? "", transcript);
      } catch (error) {
        throw described(error);
      }
    },
  };
}

/**
 * 按用户选的厂商和模型装出一个润色器：清单里找到那一家，加载它说的协议，带上它的地址、这个模型要的参数和价。
 * @param {object} options
 * @param {{ vendor: string, model: string }} options.choice
 * @param {string | null} [options.customUrl] 自定义服务的地址（设置里的 customUrl）
 * @param {Record<string, unknown> | null} [options.customParams] 自定义服务的额外参数（设置里的 customParams）
 * @param {string} options.apiKey
 * @param {typeof fetch} [options.fetch] 测试时换成假的
 */
export async function createChatPolisher({
  choice,
  customUrl = null,
  customParams = null,
  apiKey,
  timeoutMs,
  log,
  onCall,
  fetch,
}) {
  const vendor = findChatVendor(choice.vendor);
  if (!vendor) throw new LocalizedError(msg("key.unknownProvider", { id: choice.vendor }));
  const { baseUrl, name } = chatEndpoint(vendor, { customUrl });
  const protocol = await PROTOCOLS[vendor.protocol].load();
  const costOf = vendor.prices ? (await vendor.prices()).costOf : null;
  const client = protocol.createClient({
    baseUrl,
    apiKey,
    model: choice.model,
    name,
    request: requestFor(vendor, choice.model, { customParams }),
    costOf,
    ...(fetch ? { fetch } : {}),
  });
  return createPolisher({
    endpoint: { id: vendor.id, name },
    client,
    classify: (error) => protocol.classifyError(error, { name }),
    apiKey,
    timeoutMs,
    log,
    onCall,
  });
}
