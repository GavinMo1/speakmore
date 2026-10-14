import { Converter } from "opencc-js/t2cn";
import { toWav } from "../audio/transcode.mjs";
import { toModelError } from "../providers/errors.mjs";
import { findProvider } from "../providers/index.mjs";
import { NO_SPEECH_MARK, SYSTEM_PROMPT, TASK_REMINDER } from "./prompt.mjs";

// 下面三样都是模型偶尔写坏的地方，提示词里说了也压不住，所以在代码里兜底。
// 数字来自 scripts/dev/eval-prompt.mjs：同一批 60 条真实录音跑了 12 遍，共 720 条成品。

const toSimplified = Converter({ from: "t", to: "cn" });
/**
 * 成品前面多出来的一个外文词（720 条里 14 条，像 "me""thought""get_prompt""особен"）。
 * 它们要么紧贴着后面的汉字，要么单独占一行；他真以英文开头时后面是空格或标点（原版 2853 条成品里只有 1 条例外）。
 */
const LEAKED_PREFIX = /^[A-Za-z_Ѐ-ӿ]+(?:\.?(?=[一-鿿])|[ \t]*\n\s*)/;
/** 模型听音频时自带"几分几秒"的定位，偶尔会写进正文（720 条里 10 条，像"全面开干、 00:30 全面迁移"） */
const STRAY_TIMESTAMP = /(?<!\d)\d{1,2}:\d{2}(?!\d)/;

/** 一次请求最多等多久。Gemini 一两秒、OpenAI 一分半的录音七八秒，留足余量 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * "音频进、成品文字出"的那一步。各家共用这一个流程：录音的格式这家不收就先换好，交给适配器拿原文，
 * 再统一收尾；适配器只管"这一家的请求怎么拼、报错怎么认"。
 *
 * 每一次回了话的调用都记一笔账（onCall）：哪次听写、用的哪个型号、多少 token、多少钱、等了多久。
 * 回了话才收钱，所以连不上、被取消的不记；回了话但用不了的（被截断、被拦下）照记。
 *
 * @param {object} options
 * @param {{ id: string, name: string }} options.provider 厂商清单里的那一项（providers/index.mjs）
 * @param {{ ping(o: { signal: AbortSignal }): Promise<{ usage: object }>, generate(request: object): Promise<{ text: string | null | undefined, problem: string | null, usage: object }> }} options.client
 *   这一家的适配器（providers/*.mjs 的 createClient）
 * @param {string[]} options.audioTypes 这一家直接收的录音格式
 * @param {(error: unknown, detail: string) => object | null} [options.classify] 这一家的报错怎么认
 * @param {string} [options.apiKey] 只用来从报错里抹掉它
 * @param {(audio: Buffer, mimeType: string) => Promise<{ audio: Buffer, mimeType: string }>} [options.transcode]
 * @param {(record: object) => void} [options.onCall] 记账：{ purpose: "dictation" | "check", audioId, provider,
 *   ...适配器带回的用量, latencyMs, createdAt }。它出错不影响这次听写
 * @returns {{ warmUp(): Promise<void>, refine(audio: Buffer, o: { mimeType: string, signal?: AbortSignal, audioId?: string }): Promise<string> }}
 *   出错时抛的都是 ModelError
 */
export function createRefiner({
  provider,
  client,
  audioTypes,
  classify,
  apiKey,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log,
  transcode = toWav,
  onCall = () => {},
}) {
  const described = (error) => toModelError(error, { provider, apiKey, classify });
  const withTimeout = (signal) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  };

  /** 调一次适配器，回了话就记一笔账。没回话（抛错）的不记 */
  async function metered(purpose, audioId, call) {
    const startedAt = performance.now();
    const reply = await call();
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!reply?.usage) {
      log.warn("usage_missing", { purpose, audio_id: audioId, provider: provider.id });
      return reply;
    }
    const { usage } = reply;
    // 只记数，不记成品：成品是用户说的话
    log.info("model_call", {
      purpose,
      audio_id: audioId,
      model: usage.model,
      input_tokens: usage.inputTokens,
      audio_tokens: usage.audioTokens,
      cached_tokens: usage.cachedTokens,
      output_tokens: usage.outputTokens,
      thinking_tokens: usage.thinkingTokens,
      cost_usd: usage.costUsd,
      latency_ms: latencyMs,
    });
    try {
      onCall({ purpose, audioId, provider: provider.id, ...usage, latencyMs, createdAt: new Date().toISOString() });
    } catch (error) {
      // 账没记上只是少一笔统计，不能因此把用户的这句话丢掉
      log.error("model_call_not_recorded", { audio_id: audioId, error: String(error?.stack ?? error) });
    }
    return reply;
  }

  return {
    /**
     * 启动时发一个最小的请求。实测进程里第一次整理要 3.4–4.1 秒，之后稳定在 1.7–1.9 秒
     * （Gemini，闲置 3 分钟后也是）；先发这一个，慢的那一次就不会落在用户的第一句话上。
     * key 无效或模型名写错也会在这里暴露，不用等到第一次听写。
     */
    async warmUp() {
      try {
        await metered("check", null, () => client.ping({ signal: AbortSignal.timeout(timeoutMs) }));
      } catch (error) {
        throw described(error);
      }
    },

    /**
     * @param {{ mimeType: string, signal?: AbortSignal, audioId?: string }} options audioId：这是哪一次听写，记账时用
     * @returns {Promise<string>} 整理好的文字；没有人声时是空字符串
     */
    async refine(audio, { mimeType, signal, audioId = null }) {
      try {
        // 只换一次：夹着时间戳要重来时用的是同一份
        const input = audioTypes.includes(mimeType)
          ? { audio, mimeType }
          : await timed(log, () => transcode(audio, mimeType));
        const generateOnce = async () => {
          const reply = await metered("dictation", audioId, () =>
            client.generate({
              ...input,
              systemPrompt: SYSTEM_PROMPT,
              reminder: TASK_REMINDER,
              signal: withTimeout(signal),
            }),
          );
          if (reply.problem) throw new Error(reply.problem);
          return textFromModelOutput(reply.text);
        };
        return await generateClean(generateOnce, log);
      } catch (error) {
        throw described(error);
      }
    },
  };
}

/** 换格式花了多久记一笔：它算在用户等成品的时间里 */
async function timed(log, transcode) {
  const startedAt = performance.now();
  const converted = await transcode();
  log.info("audio_transcoded", { to: converted.mimeType, ms: Math.round(performance.now() - startedAt) });
  return converted;
}

/**
 * 按用户选的厂商和模型装出一个 refiner：清单里找到那一家，加载它的适配器，交给上面的共用流程。
 * @param {object} options
 * @param {{ provider: string, model: string }} options.choice
 * @param {string} options.apiKey
 * @param {string} [options.thinkingLevel] 只有 Gemini 用得上
 * @param {(record: object) => void} [options.onCall] 记账，见 createRefiner
 */
export async function createModelRefiner({ choice, apiKey, thinkingLevel, timeoutMs, log, onCall }) {
  const provider = findProvider(choice.provider);
  if (!provider) throw new Error(`不认识 ${choice.provider} 这家模型厂商`);
  const adapter = await provider.load();
  return createRefiner({
    provider,
    client: adapter.createClient({ apiKey, model: choice.model, thinkingLevel }),
    audioTypes: adapter.AUDIO_TYPES,
    classify: adapter.classifyError,
    apiKey,
    timeoutMs,
    log,
    onCall,
  });
}

/**
 * 拿一次成品；里面夹着时间戳就重来一次，用第二次的结果。
 * 不直接把时间戳删掉，是因为他也可能真的说了钟点：重来一遍还有，就当是他说的。
 * 原版 2853 条成品里没有一条带这种写法，所以多出来的这一次请求几乎只落在写坏的成品上。
 *
 * @param {() => Promise<string>} generateOnce
 * @param {{ warn: (event: string, fields: object) => void }} log
 */
export async function generateClean(generateOnce, log) {
  const first = await generateOnce();
  if (!STRAY_TIMESTAMP.test(first)) return first;
  log.warn("refine_retry", { reason: "成品里夹着时间戳" });
  return generateOnce();
}

/**
 * 模型的原始输出 → 要贴出去的文字。没有人声（标记）或没有输出时是空字符串。
 * - 繁转简：提示词里写了"一律写简体字"，模型仍会在一长段话中间冒出"這個"，同一条录音 6 遍里出现 5 遍。
 * - 去掉最后的句号：原版近两个月的成品里，以陈述句收尾的有八成多不带句号，中间各段的句号都在。
 */
export function textFromModelOutput(output) {
  const text = (output ?? "").trim();
  if (text === NO_SPEECH_MARK) return "";
  return toSimplified(text.replace(LEAKED_PREFIX, "")).replace(/。$/, "");
}
