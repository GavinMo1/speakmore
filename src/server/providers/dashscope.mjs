import { msg } from "../../i18n/index.mjs";
import { quote } from "./errors.mjs";

// 阿里云百炼的接口（DashScope）几个角色共用的部分：发请求、认报错。原生（bailian.mjs）、云端转写（asr/cloud/bailian.mjs）
// 都走这里；润色走通用的 OpenAI 兼容协议（chat/openai-chat.mjs），不用这个。
// 国内站有两套地址：OpenAI 兼容的 /compatible-mode/v1，和 DashScope 自己的 /api/v1。有的模型只认其中一套
// （qwen-audio-3.1-asr-flash 在兼容地址上回 404 "Unsupported model … for OpenAI compatibility mode"，2026-10-16 实测），
// 所以地址由各个适配器按模型挑。两套的报错都是 JSON：兼容地址写成 {"error":{"message","code"}}，
// 自己那套写成 {"code","message"}。

export const COMPATIBLE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const DASHSCOPE_URL = "https://dashscope.aliyuncs.com/api/v1";

/** 百炼回了一个错误。status 是 HTTP 状态码，code 是它给的错误码（InvalidApiKey、Arrearage…），said 是原话 */
export class DashScopeError extends Error {
  constructor(status, code, said) {
    super(`百炼回了 ${status}${code ? ` ${code}` : ""}：${said || "（没有说明）"}`);
    this.name = "DashScopeError";
    this.status = status;
    this.code = code;
    this.said = said;
  }
}

/**
 * POST 一个 JSON 请求，读完整个回话再解析。不是 2xx 就抛 DashScopeError
 * @param {string} url
 * @param {{ apiKey: string, body: object, signal?: AbortSignal, headers?: object, fetch?: typeof fetch }} options
 */
export async function post(url, { apiKey, body, signal, headers = {}, fetch = globalThis.fetch }) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // 网关偶尔回一页 HTML：按状态码说，正文不要
  }
  if (!response.ok) {
    const error = payload?.error ?? payload ?? {};
    throw new DashScopeError(
      response.status,
      error.code ?? null,
      typeof error.message === "string" ? error.message : "",
    );
  }
  return payload;
}

/**
 * 认百炼回的报错。错误码照百炼的错误码文档，"没开通"那句是 2026-10-16 调原厂代理的模型实测的原话。不认得的返回 null
 * @param {unknown} error
 * @param {{ name: string }} endpoint 报错时怎么称呼对面
 */
export function classifyError(error, { name }) {
  if (!(error instanceof DashScopeError)) return null;
  const said = quote(error.said) || `HTTP ${error.status}`;
  if (error.status === 401 || error.code === "InvalidApiKey" || error.code === "invalid_api_key") {
    return { kind: "key", problem: msg("model.keyInvalid") };
  }
  // 欠费
  if (error.code === "Arrearage") return { kind: "key", problem: msg("model.noQuota") };
  if (/not activated/i.test(error.said))
    return { kind: "other", problem: msg("model.notActivated", { provider: name }) };
  if (error.status === 403) return { kind: "key", problem: msg("model.forbidden", { said }) };
  if (error.status === 429 || error.status >= 500) {
    return { kind: "unavailable", problem: msg("model.unavailable", { provider: name, said }) };
  }
  if (error.status === 404 || error.code === "model_not_found" || error.code === "ModelNotFound") {
    return { kind: "other", problem: msg("model.notFound", { provider: name, said }) };
  }
  return { kind: "other", problem: msg("model.rejected", { provider: name, said }) };
}
