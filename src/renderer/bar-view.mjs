// 悬浮条该是什么样子：由状态机的状态算出来，纯函数，不碰页面。
// 真正把它画出来的是 bar-ui.mjs。

import { Phase } from "./machine.mjs";

export const View = Object.freeze({
  HIDDEN: "hidden",
  STARTING: "starting", // 打开麦克风：声波伏着，一明一暗
  RECORDING: "recording", // 正在听：声波跟着声音动
  FINISHING: "finishing", // 整理中：一道匀速滚过的波
  DONE: "done", // 文字贴出去了：打个勾
  NOTICE: "notice", // 一句提示
  ERROR: "error", // 出错：图标加原因
});

/** 收尾的样子在屏幕上留多久再消失。说话时的样子不在这里：它们一直留到阶段变了为止 */
export const LINGER_MS = Object.freeze({
  [View.DONE]: 900,
  [View.NOTICE]: 4_000,
  [View.ERROR]: 4_000,
});

/**
 * @param {{ phase: string, message: string | null }} state 状态机现在的状态
 * @param {string} previousPhase 变成现在这样之前的阶段
 */
export function viewOf(state, previousPhase) {
  switch (state.phase) {
    case Phase.STARTING:
      return View.STARTING;
    case Phase.RECORDING:
      return View.RECORDING;
    case Phase.FINISHING:
      return View.FINISHING;
    case Phase.ERROR:
      return View.ERROR;
    default:
      if (state.message !== null) return View.NOTICE;
      // 刚拿到成品、没有别的话要说：打个勾再走。取消的、提示放完了的，直接消失
      return previousPhase === Phase.FINISHING ? View.DONE : View.HIDDEN;
  }
}

/**
 * 条上方的那行提示。
 * @param {string} view
 * @param {{ keycap: string, cancellable: boolean }} options keycap：热键的短名字；cancellable：esc 截不截得住
 * @returns {Array<string | { key: string }>} 一段一段的：文字，或者一个要标成键名的键
 */
export function hintFor(view, { keycap, cancellable }) {
  switch (view) {
    case View.STARTING:
      return ["正在打开麦克风"];
    case View.RECORDING:
      return cancellable
        ? ["再按一下 ", { key: keycap }, " 完成 · ", { key: "esc" }, " 取消"]
        : ["再按一下 ", { key: keycap }, " 完成"];
    case View.FINISHING:
      return ["整理中"];
    default:
      return [];
  }
}

/** 这个样子下，条上哪几个按钮点得动 */
export function controlsIn(view) {
  if (view === View.STARTING) return ["cancel"];
  if (view === View.RECORDING) return ["cancel", "confirm"];
  return [];
}

/** 声波里一共多少根竖条。每 50 ms 进一根新的，所以这也是它记得多久的声音 */
export const WAVE_BARS = 16;

/** 低于这个就当没声音：页面拿到的波形是 8 位的，这是它分辨得出的最小一格 */
const QUIET = 1 / 128;
/**
 * 到这个音量就画满。按真实录音定的（三段共 35 秒，每 50 ms 一个音量）：
 * 中位数 0.023，九成的时候不超过 0.094，最响到过 0.2。
 */
const LOUD = 0.19;

/**
 * 一个瞬时音量画成多高的竖条。
 * @param {number} level 0–1
 * @returns {number} 0.1–1，占声波区域高度的比例
 */
export function barHeight(level) {
  if (level <= QUIET) return 0.1;
  // 按"比最小的声音响多少倍"来画（对数），不按音量本身：说话的音量挤在很低的一段，
  // 直接画的话竖条大部分时候只有两三成高，看不出在跟着声音动（开方也不够，试过）
  const loudness = Math.log(level / QUIET) / Math.log(LOUD / QUIET);
  return 0.1 + Math.min(1, loudness) * 0.9;
}
