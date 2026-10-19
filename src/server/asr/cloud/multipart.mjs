import { msg } from "../../../i18n/index.mjs";
import { quote } from "../../providers/errors.mjs";

// 用 multipart/form-data 上传录音的转写接口共用的部分：发请求、认报错。智谱的 /audio/transcriptions（zhipu.mjs）、
// MiniMax 的 /speech_to_text（minimax.mjs）都是这种：交一个音频文件和几个字段，一次回整段原文。
// 两家的报错都照 OpenAI 的写法放在 {"error":{…}} 里：智谱的业务码在 error.code（"1113"），MiniMax 的在 error.type
// （insufficient_balance_error），都收进 code，各家的适配器再按自己的码细分。

/** 转写接口回了一个错误。status 是 HTTP 状态码，code 是它给的错误码，said 是它说的原话（认不出时是空的） */
export class UploadError extends Error {
  constructor(name, status, code, said) {
    super(`${name} 回了 ${status}${code ? ` ${code}` : ""}：${said || "（没有说明）"}`);
    this.name = "UploadError";
    this.status = status;
    this.code = code;
    this.said = said;
  }
}

/**
 * 把一段 wav 连同几个字段 POST 出去，读完整个回话再解析。不是 2xx 就抛 UploadError
 * @param {string} url
 * @param {{ name: string, apiKey: string, wav: Buffer, fields: Record<string, string | readonly string[]>,
 *   signal?: AbortSignal, fetch?: typeof fetch }} options name 是报错时怎么称呼对面；值是数组的字段每一项发一个同名字段
 */
export async function postAudio(url, { name, apiKey, wav, fields, signal, fetch = globalThis.fetch }) {
  const form = new FormData();
  for (const [field, value] of Object.entries(fields)) {
    for (const each of Array.isArray(value) ? value : [value]) form.append(field, each);
  }
  form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
  // Content-Type 不自己写：fetch 按 FormData 写上带分隔串的那个
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
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
    throw new UploadError(
      name,
      response.status,
      error.code ?? error.type ?? null,
      typeof error.message === "string" ? error.message : "",
    );
  }
  return payload;
}

/**
 * 回话里识别出的原文。回了 2xx 却没有这一项，说明接口和文档对不上：照实报错，不当成"没听到声音"
 * @param {object | null} payload
 * @param {string} name 报错时怎么称呼对面
 */
export function textIn(payload, name) {
  if (typeof payload?.text !== "string") throw new Error(`${name} 的回话里没有识别出的原文（text）`);
  return payload.text;
}

/**
 * 按 HTTP 状态码认这个模块抛的报错，惯例同 OpenAI：401 key 不对、402 没余额、403 没权限、429 和 5xx 暂时用不了。
 * 不是 UploadError 的返回 null
 * @param {unknown} error
 * @param {{ name: string }} endpoint 报错时怎么称呼对面
 */
export function classifyError(error, { name }) {
  if (!(error instanceof UploadError)) return null;
  // 回的不是 JSON 时没有原话，至少带上状态码
  const said = quote(error.said) || `HTTP ${error.status}`;
  if (error.status === 401) return { kind: "key", problem: msg("model.keyInvalid") };
  if (error.status === 402) return { kind: "key", problem: msg("model.noQuota") };
  if (error.status === 403) return { kind: "key", problem: msg("model.forbidden", { said }) };
  if (error.status === 429 || error.status >= 500) {
    return { kind: "unavailable", problem: msg("model.unavailable", { provider: name, said }) };
  }
  if (error.status === 404) return { kind: "other", problem: msg("model.notFound", { provider: name, said }) };
  return { kind: "other", problem: msg("model.rejected", { provider: name, said }) };
}
