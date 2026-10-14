// 模型那边出的错，统一分成三类，调用方按类别决定怎么办，不用认识每家的报错长什么样：
//   key          这把 key 不对（无效、没额度、没权限）：换一把能解决
//   unavailable  暂时够不着（没网、超时、它那边出状况或限流）：和 key、设置都没关系，过一会儿再试
//   other        它拒绝了这个请求（多半是模型名、档位写错），或者录音有问题
// message 是给用户看的一句话（句尾不带标点，后面常要接别的话）；detail 是抹掉 key 之后的原文，留给日志。

const PROBLEM_MAX_LENGTH = 200;

export class ModelError extends Error {
  /** @param {{ kind: "key" | "unavailable" | "other", problem: string, detail: string }} fields */
  constructor({ kind, problem, detail }) {
    super(problem);
    this.name = "ModelError";
    this.kind = kind;
    this.detail = detail;
  }
}

/**
 * 任意一个错误 → ModelError。先认够不着的情况（各家都一样），再交给那一家的适配器认它自己的报错，
 * 都不认得就把原话截短了给人看。
 * @param {unknown} error
 * @param {object} context
 * @param {{ name: string }} context.provider
 * @param {string} [context.apiKey] 当时用的那把：报错里带着它的话先抹掉
 * @param {(error: unknown, detail: string) => { kind: string, problem: string } | null} [context.classify]
 */
export function toModelError(error, { provider, apiKey, classify }) {
  if (error instanceof ModelError) return error;
  let detail = String(error?.message ?? error);
  if (apiKey) detail = detail.replaceAll(apiKey, "（key）");
  if (error?.name === "AbortError" || error?.name === "TimeoutError" || /fetch failed/.test(detail)) {
    return new ModelError({ kind: "unavailable", problem: `连不上 ${provider.name}，检查网络后再试`, detail });
  }
  const specific = classify?.(error, detail);
  if (specific) return new ModelError({ ...specific, detail });
  return new ModelError({ kind: "other", problem: detail.slice(0, PROBLEM_MAX_LENGTH), detail });
}

/** 把模型回的一句话收拾成能接在中文后面的样子：去掉句尾的句号和空白，截短 */
export const quote = (said) =>
  String(said ?? "")
    .replace(/[.。\s]+$/, "")
    .slice(0, 160);
