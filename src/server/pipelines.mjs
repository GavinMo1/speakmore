import { LocalizedError, msg } from "../i18n/index.mjs";
import { findChatVendor, formatChatChoice, parseChatChoice } from "./chat/vendors.mjs";
import { findProvider, formatModelChoice, parseModelChoice } from "./providers/index.mjs";
import { createLocalRefiner } from "./refine/local.mjs";
import { createChatPolisher } from "./refine/polisher.mjs";
import { createModelRefiner } from "./refine/refiner.mjs";
import { VENDORS } from "./vendors.mjs";

// 识别的两条链路，用户在设置里选一条（pipeline）。两条平级，谁也不是谁的退路：
//   native  原生：录音直接交给收音频的大模型，一次请求出成品（refine/refiner.mjs）
//   local   本地转写：本机的小模型先把录音转成原文，再交给任意纯文字大模型润色（refine/local.mjs）
// 装出来的都是同一个接口（warmUp、prepare、refine），服务端只认这个接口。
//
// "路线"（route）写清这一条要用哪些东西，由设置或环境变量拼出来：
//   { pipeline: "native", model: { provider, model }, thinkingLevel }
//   { pipeline: "local", transcriber: 本地模型的 id, polish: { vendor, model }, customUrl }
// 本地转写链路的转写器（装着模型的子进程，asr/host.mjs）由调用方装好交进来：它的去留跟着模型走，
// 换一把 key、换一家润色都不该把模型重装一遍。

/** 设置里没写时用哪个本地模型：第一轮评测里最准的那个（bench/results/asr-round1-2026-10-16.md）。用户可以换 */
export const DEFAULT_TRANSCRIBER = "qwen3-asr-0.6b-q8";
/** 设置里没写时润色交给谁 */
export const DEFAULT_POLISH = "deepseek";

export const PIPELINES = Object.freeze([
  Object.freeze({
    id: "native",
    /** 要用谁家的 key */
    keyVendor: (route) => findProvider(route.model.provider),
    describe: (route) => formatModelChoice(route.model),
    create: ({ route, apiKey, log, onCall }) =>
      createModelRefiner({ choice: route.model, apiKey, thinkingLevel: route.thinkingLevel, log, onCall }),
  }),
  Object.freeze({
    id: "local",
    keyVendor: (route) => findChatVendor(route.polish.vendor),
    describe: (route) => `${route.transcriber} → ${formatChatChoice(route.polish)}`,
    async create({ route, apiKey, transcriber, log, onCall, decode, fetch }) {
      if (!transcriber) throw new Error(`本地转写链路要先装好转写器（${route.transcriber}）`);
      const polisher = await createChatPolisher({
        choice: route.polish,
        customUrl: route.customUrl,
        apiKey,
        log,
        onCall,
        fetch,
      });
      return createLocalRefiner({ transcriber, polisher, log, ...(decode ? { decode } : {}) });
    },
  }),
]);

export const DEFAULT_PIPELINE = "native";

/** @returns {(typeof PIPELINES)[number] | null} 大小写不论 */
export function findPipeline(id) {
  const wanted = String(id ?? "").toLowerCase();
  return PIPELINES.find((pipeline) => pipeline.id === wanted) ?? null;
}

/** 用户写的链路 → 它的 id。写错了就抛 LocalizedError，说能填什么 */
export function parsePipeline(value) {
  const pipeline = findPipeline(String(value ?? "").trim());
  if (!pipeline) {
    throw new LocalizedError(msg("settings.oneOf", { choices: PIPELINES.map(({ id }) => id).join(" / ") }));
  }
  return pipeline.id;
}

/**
 * "成品交给哪一家的哪个模型"：命令行的 speakmore model、设置里改用别家都这么写。
 * 收音频的那几家（providers/）走原生链路，只收文字的（chat/vendors.mjs）走本地转写链路，由它润色。
 * 写法同各自的那一种：厂商、厂商/模型；只写一个 Gemini 的模型名是 0.3 以前的写法，照样认。
 * @returns {{ pipeline: "native", model: { provider, model } } | { pipeline: "local", polish: { vendor, model } }}
 *   写错了抛 LocalizedError
 */
export function parseFinalModel(value) {
  const text = String(value ?? "").trim();
  const name = text.split("/")[0];
  if (!findProvider(name) && findChatVendor(name)) return { pipeline: "local", polish: parseChatChoice(text) };
  if (text.includes("/") && !findProvider(name)) {
    throw new LocalizedError(
      msg("models.unknownProvider", { name, providers: VENDORS.map(({ id }) => id).join(" / ") }),
    );
  }
  return { pipeline: "native", model: parseModelChoice(text) };
}

export const formatFinalModel = (choice) =>
  choice.pipeline === "local" ? formatChatChoice(choice.polish) : formatModelChoice(choice.model);

/** 这条路线要用谁家的 key：{ id, name, keyEnv, keyPage } */
export const keyVendorOf = (route) => findPipeline(route.pipeline).keyVendor(route);

/** 一句话说清这条路线，给日志和状态用 */
export const describeRoute = (route) => `${route.pipeline}: ${findPipeline(route.pipeline).describe(route)}`;

/**
 * 按路线装出一个 refiner。
 * @param {object} options
 * @param {object} options.route
 * @param {string} options.apiKey 这条路线要的那家的 key（keyVendorOf）
 * @param {object} [options.transcriber] 本地转写链路要的转写器（asr/host.mjs 的 spawnTranscriber）
 */
export function createPipelineRefiner(options) {
  return findPipeline(options.route.pipeline).create(options);
}
