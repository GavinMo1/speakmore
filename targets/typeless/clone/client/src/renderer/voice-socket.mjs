// 和服务端之间的那条 WebSocket。消息名和字段照抄原版（docs/05-network-protocol.md）。
// 只依赖标准的 WebSocket，所以浏览器和 Node 里都能跑，测试直接连真的服务端模块。

/** 原版听写等成品的超时：VOICE_TRANSCRIPT_REFINE_TIMEOUT_MS */
export const REFINE_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 5_000;
const CHUNK_SECONDS = 3;

export class VoiceSocket {
  #url;
  #socket = null;
  /** 当前这次录音：{ audioId, nextIndex, sending, failure, settle } */
  #current = null;

  constructor(url) {
    this.#url = url;
  }

  /** 用的时候才连，连着就复用。原版也是这样：空闲被断开后，下次按键再连 */
  async #connected() {
    if (this.#socket?.readyState === WebSocket.OPEN) return this.#socket;
    const socket = new WebSocket(this.#url);
    socket.binaryType = "arraybuffer";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("连接服务端超时"));
      }, CONNECT_TIMEOUT_MS);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`连不上服务端 ${this.#url}`));
      });
    });
    socket.addEventListener("message", (event) => this.#onMessage(event.data));
    socket.addEventListener("close", () => {
      if (this.#socket === socket) this.#socket = null;
      this.#fail(new Error("和服务端的连接断了"));
    });
    this.#socket = socket;
    return socket;
  }

  /** 开始一次录音。连不上会在这里抛出 */
  async begin(audioId) {
    const socket = await this.#connected();
    this.#current = { audioId, nextIndex: 1, sending: Promise.resolve(), failure: null, settle: null };
    socket.send(
      JSON.stringify({
        type: "start_audio",
        audio_id: audioId,
        audio_chunk_time: CHUNK_SECONDS,
        audio_metadata: { audio_format: "webm", audio_codec: "opus", audio_channels: 1, need_merge: true },
        mode: "voice_transcript",
      }),
    );
  }

  /**
   * 发一块音频。录音器每 3 秒吐一块，这里排队按序发：
   * 取字节数是异步的，不排队的话后一块可能抢到前一块前面。
   * @param {Blob} blob
   */
  sendChunk(blob) {
    const current = this.#current;
    if (!current) throw new Error("还没有开始录音就发了音频块");
    current.sending = current.sending.then(async () => {
      const bytes = await blob.arrayBuffer();
      if (this.#current !== current || current.failure) return;
      const index = current.nextIndex++;
      this.#socket.send(
        JSON.stringify({ type: "set_audio_chunk_info", audio_id: current.audioId, index, size: bytes.byteLength }),
      );
      this.#socket.send(bytes);
    });
    // 发送失败记在这次录音上，finish 时一并报出来，不让它变成没人接的拒绝
    current.sending = current.sending.catch((error) => this.#fail(error));
  }

  /**
   * 结束录音，等成品文字。
   * @returns {Promise<string>} 没有人声时是空字符串
   */
  async finish({ durationSeconds, timeoutMs = REFINE_TIMEOUT_MS }) {
    const current = this.#current;
    if (!current) throw new Error("还没有开始录音就结束了");
    await current.sending;
    if (current.failure) {
      this.#current = null;
      throw current.failure;
    }
    const result = new Promise((resolve, reject) => {
      current.settle = { resolve, reject };
    });
    this.#socket.send(
      JSON.stringify({
        type: "end_audio",
        audio_id: current.audioId,
        total_duration: durationSeconds,
        mode: "voice_transcript",
      }),
    );
    const timer = setTimeout(() => this.#fail(new Error(`等了 ${timeoutMs / 1000} 秒没有等到成品`)), timeoutMs);
    try {
      return await result;
    } finally {
      clearTimeout(timer);
      if (this.#current === current) this.#current = null;
    }
  }

  /** 丢弃当前这次录音。服务端在下一个 start_audio 或断开时清掉它那边的状态 */
  abandon() {
    this.#current = null;
  }

  close() {
    this.#current = null;
    this.#socket?.close();
    this.#socket = null;
  }

  #fail(error) {
    const current = this.#current;
    if (!current || current.failure) return;
    current.failure = error;
    current.settle?.reject(error);
  }

  #onMessage(data) {
    const { K: kind, V: value } = JSON.parse(data);
    const current = this.#current;
    // 上一次录音迟到的消息不能算到这一次头上
    if (!current || (value.audio_id && value.audio_id !== current.audioId)) return;
    switch (kind) {
      case "audio_processing_completed":
        current.settle?.resolve(value.refined_text);
        break;
      case "audio_processing_error":
      case "error":
        this.#fail(new Error(`服务端报错 ${value.code}：${value.detail}`));
        break;
      // audio_session_started、received_audio_chunk_count、audio_session_ending 只是进度，用不到
    }
  }
}
