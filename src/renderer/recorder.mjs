// 录音：打开麦克风，每 3 秒吐一块 Opus。参数照原版（docs/11-audio-recorder.md）：
// 单声道、32 kbps、3 秒一块，回声消除、降噪、自动增益全部关掉，把未加工的声音交给模型。
// 和原版不同的是容器：原版自带编码库出 Ogg，这里用浏览器自带的 MediaRecorder，出的是 WebM。

const CHUNK_MS = 3_000;
const MIME_TYPE = "audio/webm;codecs=opus";
const LEVEL_INTERVAL_MS = 100;

/**
 * @param {object} handlers
 * @param {(chunk: Blob) => void} handlers.onChunk 每 3 秒一块，结束时还有最后一块
 * @param {(level: number) => void} handlers.onLevel 0–1 的瞬时音量，每 100 ms 一次
 * @param {(error: Error) => void} handlers.onError 录音中途出错
 */
export async function startRecording({ onChunk, onLevel, onError }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const recorder = new MediaRecorder(stream, { mimeType: MIME_TYPE, audioBitsPerSecond: 32_000 });
  const chunks = [];
  let cancelled = false;

  recorder.addEventListener("dataavailable", (event) => {
    if (cancelled || event.data.size === 0) return;
    chunks.push(event.data);
    onChunk(event.data);
  });
  recorder.addEventListener("error", (event) => {
    if (!cancelled) onError(new Error(`录音出错：${event.error?.message ?? "原因不明"}`));
  });

  // 音量：给界面一点反馈，也用来发现"麦克风完全没信号"（设备被静音、选错了输入）。
  // 判断标准和原版一样：8 位波形只要偏离中点 1 格就算有信号。它不是在判断有没有人说话。
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  audioContext.createMediaStreamSource(stream).connect(analyser);
  const waveform = new Uint8Array(analyser.fftSize);
  let peak = 0;
  const meter = setInterval(() => {
    analyser.getByteTimeDomainData(waveform);
    let deviation = 0;
    for (const sample of waveform) deviation = Math.max(deviation, Math.abs(sample - 128));
    peak = Math.max(peak, deviation);
    onLevel(deviation / 128);
  }, LEVEL_INTERVAL_MS);

  const release = () => {
    clearInterval(meter);
    for (const track of stream.getTracks()) track.stop();
    audioContext.close().catch((error) => console.warn("关闭 AudioContext 失败", error));
  };

  const startedAt = performance.now();
  recorder.start(CHUNK_MS);

  return {
    /** 结束录音。最后一块会先经 onChunk 交出去，然后这里才返回 */
    stop() {
      return new Promise((resolve) => {
        recorder.addEventListener(
          "stop",
          () => {
            release();
            resolve({
              blob: new Blob(chunks, { type: MIME_TYPE }),
              durationSeconds: (performance.now() - startedAt) / 1000,
              hadSignal: peak >= 1,
            });
          },
          { once: true },
        );
        recorder.stop();
      });
    },
    /** 丢弃这次录音，已经录下的不再交出去 */
    cancel() {
      cancelled = true;
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}
