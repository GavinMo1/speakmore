import { msg, problemOf } from "../../i18n/index.mjs";
import { SPEECH_SAMPLE_RATE } from "../audio/pcm.mjs";
import { toSpeech } from "../audio/transcode.mjs";
import { ModelError } from "../providers/errors.mjs";

// 本地转写链路：录音 → 统一成 16 kHz 单声道 → 本地模型转写（第一跳）→ 纯文字模型润色（第二跳）→ 成品。
// 和原生链路（refiner.mjs）平级，对外的接口一样（warmUp、prepare、refine），服务端不用知道走的是哪一条。
// 两跳各是一个策略：转写器是哪个模型由模型清单和转写进程管（asr/），润色交给哪一家由润色器管（polisher.mjs），
// 这里只管把它们按顺序接起来。

/**
 * @param {object} options
 * @param {{ transcribe(samples: Float32Array): Promise<{ text: string }> }} options.transcriber 第一跳（asr/host.mjs）
 * @param {{ warmUp(): Promise<void>, polish(text: string, o: object): Promise<string> }} options.polisher 第二跳（polisher.mjs）
 * @param {{ info: Function }} options.log
 * @param {typeof toSpeech} [options.decode] 测试时换成假的
 */
export function createLocalRefiner({ transcriber, polisher, log, decode = toSpeech }) {
  /** 两跳之外的失败（解不开录音、本地转写出错）也报成 ModelError，服务端按同一套规矩告诉用户 */
  const failed = (problem, error) =>
    new ModelError({ kind: "other", problem, detail: String(error?.message ?? error), origin: error?.stack });

  return {
    /** 验证润色那一家的 key、地址和模型名，也让第一次润色不慢。转写器在装上的时候已经验过了 */
    warmUp: () => polisher.warmUp(),

    /** 开口时没什么要先备的：模型一直装在转写进程里 */
    async prepare() {},

    async refine(audio, { mimeType, signal, audioId = null }) {
      const startedAt = performance.now();
      let samples;
      try {
        samples = await decode(audio, mimeType);
      } catch (error) {
        throw failed(error?.problem ?? msg("local.undecodable", { reason: problemOf(error) }), error);
      }
      const decodedAt = performance.now();
      let transcript;
      try {
        ({ text: transcript } = await transcriber.transcribe(samples));
      } catch (error) {
        throw failed(msg("local.transcribeFailed", { reason: String(error?.message ?? error).slice(0, 200) }), error);
      }
      const transcribedAt = performance.now();
      // 转写的这段时间里用户已经断开了：润色要花钱，不必再发
      signal?.throwIfAborted();
      const refined = await polisher.polish(transcript, { signal, audioId });
      // 只记长度和耗时：原文和成品都是用户说的话
      log.info("local_refined", {
        audio_id: audioId,
        seconds: Math.round((samples.length / SPEECH_SAMPLE_RATE) * 10) / 10,
        decode_ms: Math.round(decodedAt - startedAt),
        transcribe_ms: Math.round(transcribedAt - decodedAt),
        polish_ms: Math.round(performance.now() - transcribedAt),
        transcript_length: transcript.length,
      });
      return refined;
    },
  };
}
