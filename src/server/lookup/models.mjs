// 划词翻译交给哪个文字模型：出厂用哪个，哪几个评测过（scripts/dev/eval-lookup.mjs，数字在 docs/implementation-notes.md）。
// 引擎页"划词"那一段按这里打"默认""已评测"，和整理那一步的评测不相干（server/chat/vendors.mjs 的 tested 是整理的）。

/** 出厂交给谁：只写厂商，用它的默认模型（DeepSeek V4.1 Flash：关掉思考一两句话一秒上下，价钱低） */
export const DEFAULT_LOOKUP = "deepseek";

/** 用现在的提示词跑过整套评测的：厂商/模型（V4 Pro 只在旧提示词上评过，不算） */
export const LOOKUP_TESTED = Object.freeze(["deepseek/deepseek-flash"]);
