import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { msg } from "../i18n/index.mjs";

// 一次听写结束后主进程要做的事：存录音、记历史、把文字贴出去。
// 和原版一样，录音存在 Recordings/<audio_id> 下，失败的也存（docs/08-local-data.md）。

/** audio_id 会拼进文件名，只接受页面用 crypto.randomUUID() 生成的那种格式 */
const AUDIO_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function checkRecording({ audioId, durationSeconds, audio }) {
  if (typeof audioId !== "string" || !AUDIO_ID.test(audioId)) throw new TypeError("audioId 不是 UUID");
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) throw new TypeError("durationSeconds 不是有效的时长");
  if (!(audio instanceof ArrayBuffer) && !ArrayBuffer.isView(audio)) throw new TypeError("audio 不是二进制数据");
}

/**
 * @param {object} deps
 * @param {string} deps.recordingsDir
 * @param {{ add: Function }} deps.history
 * @param {(text: string) => Promise<{ ok: boolean }>} deps.paste
 * @param {(text: string) => void} deps.writeClipboard
 * @param {{ warn: Function, error: Function }} deps.log
 */
export function createDelivery({ recordingsDir, history, paste, writeClipboard, log, now = () => new Date() }) {
  const record = (payload, fields) => {
    checkRecording(payload);
    mkdirSync(recordingsDir, { recursive: true });
    // 历史里只记文件名，不记完整路径：家目录整个搬了家也对得上
    const audioFile = `${payload.audioId}.webm`;
    const { audio } = payload;
    // 视图可能只是底层缓冲区的一段，只写它自己那一段
    const bytes = ArrayBuffer.isView(audio)
      ? new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength)
      : new Uint8Array(audio);
    writeFileSync(join(recordingsDir, audioFile), bytes);
    history.add({
      id: payload.audioId,
      duration: payload.durationSeconds,
      audioFile,
      createdAt: now().toISOString(),
      ...fields,
    });
  };

  return {
    /**
     * 成品回来了：先落盘，再贴。贴不进去时把文字放进剪贴板，用户不会丢字。
     * @returns {Promise<{ notice: object | null }>} notice 是要在悬浮条上告诉用户的话（msg，悬浮条按界面语言翻）
     */
    async completed(payload) {
      if (typeof payload.text !== "string") throw new TypeError("text 不是字符串");
      record(payload, { status: "completed", refinedText: payload.text, error: null });
      if (payload.text === "") return { notice: msg("delivery.silent") };
      try {
        const result = await paste(payload.text);
        if (result.ok) return { notice: null };
        log.warn("paste_not_permitted", { audio_id: payload.audioId, reason: result.reason });
        // 小帮手贴不进去的几种原因（native/main.swift、native/windows/main_windows.go）：
        //   not_trusted  macOS 没有辅助功能权限，文字已经留在剪贴板里
        //   elevated     Windows 上目标窗口以管理员身份运行，系统不让模拟的按键进去，文字已经留在剪贴板里
        //   clipboard    Windows 上文字没写进剪贴板（被别的程序占着）：这里再放一次，用户才有东西可贴
        //   send_input   Windows 上模拟按键没成，文字已经在剪贴板里
        if (result.reason === "not_trusted") return { notice: msg("delivery.noAccessibility") };
        if (result.reason === "elevated") return { notice: msg("delivery.elevated") };
        if (result.reason === "clipboard") writeClipboard(payload.text);
        return { notice: msg("delivery.pasteFailed") };
      } catch (error) {
        log.error("paste_failed", { audio_id: payload.audioId, error: String(error?.message ?? error) });
        writeClipboard(payload.text);
        return { notice: msg("delivery.pasteFailed") };
      }
    },

    /** 这次听写失败了：录音和原因记进历史 */
    failed(payload) {
      if (typeof payload.error !== "string") throw new TypeError("error 不是字符串");
      record(payload, { status: "failed", refinedText: "", error: payload.error });
    },
  };
}
