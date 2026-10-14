import { downsample, encodeWav, mixDown } from "./pcm.mjs";

// 把录音换成别家模型收的格式。录音是 Opus：悬浮条录的装在 WebM 里，原版 Typeless 的装在 Ogg 里。
// Gemini 两种都直接收，用不到这里；OpenAI 只收 wav 和 mp3（实测，别的格式回 400）。

/** 说话用 16 kHz 足够。实测 90 秒的录音交给 OpenAI：48 kHz 要 18 秒，16 kHz 是 7–9 秒，算的音频 token 数一样 */
const WAV_SAMPLE_RATE = 16_000;

// 用到才加载：解码器带着 WASM，只用 Gemini 的人不必付这个启动开销
const DECODERS = new Map([
  ["audio/webm", () => import("@audio/decode-webm")],
  ["audio/ogg", () => import("@audio/decode-opus")],
]);

/**
 * 录音 → 16 kHz 单声道 16 位 WAV。
 * @param {Buffer} audio 整段录音
 * @param {string} mimeType 服务端按文件头认出来的格式（见 protocol/session.mjs）
 * @returns {Promise<{ audio: Buffer, mimeType: "audio/wav" }>}
 */
export async function toWav(audio, mimeType) {
  const load = DECODERS.get(mimeType);
  if (!load) throw new Error(`没法把 ${mimeType} 换成 WAV：只认 ${[...DECODERS.keys()].join("、")}`);
  const { default: decode } = await load();
  let decoded;
  try {
    decoded = await decode(new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength));
  } catch (error) {
    throw new Error(`录音解不出声音（${mimeType}）：${error?.message ?? error}`, { cause: error });
  }
  if (!decoded?.channelData?.length || decoded.channelData[0].length === 0) {
    throw new Error(`录音解不出声音（${mimeType}）：里面没有音频`);
  }
  const samples = downsample(mixDown(decoded.channelData), decoded.sampleRate, WAV_SAMPLE_RATE);
  return { audio: encodeWav(samples, WAV_SAMPLE_RATE), mimeType: "audio/wav" };
}
