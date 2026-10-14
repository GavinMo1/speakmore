// 悬浮条的画面：告诉它现在该是什么样子，它把样子画出来、让条出现和消失、把音量画成向左流的声波。
// 该是什么样子由 bar-view.mjs 算，这里只管画。它不知道录音和网络的事，也不直接找主进程：
// 要宿主代办的两件事由调用方给。以后换一个壳时，这个文件和 bar.css 不用动，换掉那两个函数就行。

import { barHeight, controlsIn, hintFor, LINGER_MS, View, WAVE_BARS } from "./bar-view.mjs";

/** 整理中那道波有几根竖条 */
const THINK_BARS = 11;
/** 条淡出去要多久。和 bar.css 里 data-shown="false" 的过渡一样长 */
const FADE_OUT_MS = 200;
/** 按钮点得到的范围比看到的圆大一圈，正好撑满条的高度 */
const HIT_SLOP = 6;
/** 系统开了"减弱动态效果"时，声波每几次音量才动一下 */
const REDUCED_MOTION_STRIDE = 4;

/**
 * @param {object} options
 * @param {Document} options.document 悬浮条的页面（bar.html）
 * @param {object} options.host 要宿主代办的事
 * @param {(visible: boolean) => void} options.host.setVisible 把悬浮条的窗口显示出来 / 收起来
 * @param {(regions: object[] | null) => void} options.host.capture 开始截 esc 和这几块里的点击
 *   （{ id, x, y, width, height }，窗口里的位置）；null 是不截了
 * @param {string} options.keycap 热键的短名字，写在提示里
 */
export function createBarUi({ document, host, keycap }) {
  const { body } = document;
  const hint = document.getElementById("hint");
  const message = document.getElementById("message");
  const buttons = { cancel: document.getElementById("cancel"), confirm: document.getElementById("confirm") };
  const reducedMotion = document.defaultView.matchMedia("(prefers-reduced-motion: reduce)");

  const makeBars = (id, count) => {
    const bars = Array.from({ length: count }, () => document.createElement("i"));
    document.getElementById(id).replaceChildren(...bars);
    return bars;
  };
  const waveBars = makeBars("wave", WAVE_BARS);
  // 每根竖条错开一点起步，连起来才是一道滚过去的波
  for (const [index, bar] of makeBars("think", THINK_BARS).entries()) bar.style.setProperty("--i", index);

  /** 现在画着的样子。条收起来之后是 hidden */
  let view = View.HIDDEN;
  /** 两个按钮点不点得动 */
  let controls = false;
  /** 最近的音量，旧的在前。每来一个新的，最旧的那个出去 */
  let levels = Array(WAVE_BARS).fill(0);
  let samples = 0;
  /** 让宿主截着的那几块，写成一行文字方便比较；没在截是 null */
  let captured = null;
  /** 到时间把条收起来的定时器 */
  let hideTimer = null;

  function drawWave() {
    for (const [index, bar] of waveBars.entries()) bar.style.setProperty("--h", barHeight(levels[index]).toFixed(3));
  }

  function drawHint() {
    const parts = hintFor(view, { keycap, cancellable: controls });
    hint.replaceChildren(
      ...parts.map((part) =>
        typeof part === "string" ? part : Object.assign(document.createElement("kbd"), { textContent: part.key }),
      ),
    );
  }

  /** 一个按钮在窗口里的位置。按排版算，不看正在进行的动画：条出现时是从下面浮上来的，量那一刻的位置会偏 */
  function regionOf(id) {
    const button = buttons[id];
    let x = -HIT_SLOP;
    let y = -HIT_SLOP;
    for (let node = button; node !== null; node = node.offsetParent) {
      x += node.offsetLeft;
      y += node.offsetTop;
    }
    return { id, x, y, width: button.offsetWidth + 2 * HIT_SLOP, height: button.offsetHeight + 2 * HIT_SLOP };
  }

  /** 这个样子下该截什么就让宿主截什么。和上一次一样就不重复说 */
  function syncCapture() {
    const ids = controls ? controlsIn(view) : [];
    const regions = ids.length > 0 ? ids.map(regionOf) : null;
    const next = regions && JSON.stringify(regions);
    if (next === captured) return;
    captured = next;
    host.capture(regions);
  }

  function hide() {
    view = View.HIDDEN;
    syncCapture();
    // 样子先不换：照着现在的样子淡出去，淡完再把窗口收起来
    body.dataset.shown = "false";
    hideTimer = setTimeout(() => {
      host.setVisible(false);
      body.dataset.view = View.HIDDEN;
    }, FADE_OUT_MS);
  }

  return {
    /**
     * 换成这种样子。
     * @param {string} next bar-view.mjs 的 View 之一
     * @param {string | null} text 提示或者出错时的那句话
     */
    show(next, text = null) {
      // 还是这个样子、这句话：不重画，免得把正在放的动画和"过几秒收起来"的定时器重新开始
      if (next === view && (text ?? "") === message.textContent) return;
      clearTimeout(hideTimer);
      if (next === View.HIDDEN) {
        hide();
        return;
      }
      view = next;
      body.dataset.view = next;
      message.textContent = text ?? "";
      drawHint();
      if (next !== View.RECORDING) {
        levels = Array(WAVE_BARS).fill(0);
        drawWave();
      }
      if (body.dataset.shown !== "true") {
        host.setVisible(true);
        body.dataset.shown = "true";
      }
      // 排版定了才量得出按钮在哪
      syncCapture();
      if (LINGER_MS[next] !== undefined) hideTimer = setTimeout(hide, LINGER_MS[next]);
    },

    /** 正在听时的一个瞬时音量（0–1） */
    level(value) {
      if (view !== View.RECORDING) return;
      levels.push(value);
      levels.shift();
      // 减弱动态效果时声波还是要动（它在告诉人"听到你了"），只是动得慢
      if (reducedMotion.matches && ++samples % REDUCED_MOTION_STRIDE !== 0) return;
      drawWave();
    },

    /** 两个按钮点不点得动、esc 截不截得住（要辅助功能权限）。点不动时不画按钮，提示里也不提 esc */
    setControls(enabled) {
      controls = enabled;
      body.dataset.controls = String(enabled);
      if (view !== View.HIDDEN) drawHint();
      syncCapture();
    },
  };
}
