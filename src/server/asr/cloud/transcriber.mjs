import { LocalizedError, msg } from "../../../i18n/index.mjs";
import { encodeWav, SPEECH_SAMPLE_RATE } from "../../audio/pcm.mjs";
import { toModelError } from "../../providers/errors.mjs";
import { createMeter } from "../../refine/meter.mjs";
import { findCloudTranscriber } from "./vendors.mjs";

// 云端转写器：把一家的适配器包成本地转写链路第一跳要的样子，和本机的转写器（../host.mjs）同一个接口：
//   await transcriber.warmUp()                                   // 验证 key、模型名，也让第一次不慢
//   const { text } = await transcriber.transcribe(samples, { signal, audioId })   // 16 kHz 单声道
// 每次回了话记一笔账（规矩同 ../../refine/meter.mjs）：云端转写按时长或 token 收钱，和润色那一笔分开记。
// 出错时抛的都是 ModelError，服务端按同一套规矩告诉用户。

/** 一次最多等多久。实测 23 秒的录音 1.6 秒、55 秒的 1.8 秒，留足余量 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * @param {object} options
 * @param {{ vendor: string, model: string }} options.choice
 * @param {string} options.apiKey
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 * @param {(record: object) => void} [options.onCall]
 * @param {typeof fetch} [options.fetch] 测试时换成假的
 */
export async function createCloudTranscriber({
  choice,
  apiKey,
  log,
  onCall = () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetch,
}) {
  const vendor = findCloudTranscriber(choice.vendor);
  if (!vendor) throw new LocalizedError(msg("key.unknownProvider", { id: choice.vendor }));
  const adapter = await vendor.load();
  const client = adapter.createClient({ apiKey, model: choice.model, ...(fetch ? { fetch } : {}) });
  const endpoint = { id: vendor.id, name: vendor.name };
  const described = (error) => toModelError(error, { provider: endpoint, apiKey, classify: adapter.classifyError });
  const metered = createMeter({ provider: endpoint, log, onCall });
  const withTimeout = (signal) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  };

  return {
    async warmUp() {
      try {
        await metered("check", null, () => client.ping({ signal: AbortSignal.timeout(timeoutMs) }));
      } catch (error) {
        throw described(error);
      }
    },

    /**
     * @param {Float32Array} samples 16 kHz 单声道
     * @returns {Promise<{ text: string }>} 识别出的原文，去掉首尾空白，别的不动（那是润色的事）
     */
    async transcribe(samples, { signal, audioId = null } = {}) {
      const wav = encodeWav(samples, SPEECH_SAMPLE_RATE);
      try {
        const reply = await metered("dictation", audioId, () =>
          client.transcribe({ wav, signal: withTimeout(signal) }),
        );
        return { text: String(reply.text ?? "").trim() };
      } catch (error) {
        throw described(error);
      }
    },
  };
}
