import { LocalizedError, msg } from "../../i18n/index.mjs";
import { chatEndpoint, findChatVendor, PROTOCOLS, requestFor } from "./vendors.mjs";

// 按用户选的厂商和模型装出一个对话客户端：清单里找到那一家，加载它说的协议，带上它的地址、这个模型要的参数和价。
// 混合方式整理那一步（../refine/polisher.mjs）和划词翻译（../lookup/translator.mjs）都从这里拿客户端：
// 怎么连、怎么算钱、报错怎么认是同一套，让模型做什么各管各的。

/**
 * @param {object} options
 * @param {{ vendor: string, model: string }} options.choice
 * @param {string | null} [options.customUrl] 自定义服务的地址
 * @param {Record<string, unknown> | null} [options.customParams] 自定义服务的额外参数
 * @param {string} options.apiKey
 * @param {typeof fetch} [options.fetch] 测试时换成假的
 * @returns {Promise<{ endpoint: { id: string, name: string }, client: object, classify: (error: unknown) => object | null }>}
 *   endpoint 是哪一家（记账用 id，报错时称呼 name）；client 是协议客户端（openai-chat.mjs 的 createClient）；
 *   classify 认这个协议的报错
 */
export async function createChatClient({ choice, customUrl = null, customParams = null, apiKey, fetch }) {
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
  return { endpoint: { id: vendor.id, name }, client, classify: (error) => protocol.classifyError(error, { name }) };
}
