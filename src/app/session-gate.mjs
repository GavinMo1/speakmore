import { ACTIONS } from "../hotkeys/actions.mjs";
import { actionOfBinding } from "../hotkeys/bindings.mjs";

// 压住录音会话的按下：语音输入的组合是划词翻译的一部分时（默认的右⌥ 和右⌥回车），按右⌥回车的那一下，小帮手先报
// 语音输入按下、再报它被打断（升级到划词）。按下要是直接交给悬浮条，悬浮条会先亮出来、麦克风会先开，再作废，闪一下。
// 所以这样的组合按下先压住：松开了（点按）、或者 HOLD_MS 到了还没被打断，再连着交出去；被打断了就整个丢掉，
// 悬浮条什么都没看见。凑成的是语音翻译的也一样丢掉，紧跟着的语音翻译自己的按下照常开始，不用走升级。
// 只压"是别的动作某个组合的一部分"的那几个组合，别的原样过（docs/hotkey-research.md 5.3 的前缀歧义）。

/** 按下后等多久还没等来第二个键，就当是语音输入：一次点按之内，又比按组合键时两个键之间的间隔长 */
export const HOLD_MS = 250;

const isPart = (part, whole) => part.length < whole.length && part.every((code) => whole.includes(code));

/**
 * 要压住的绑定 id（"dictate#0" 这样）：录音会话动作的组合，是别的动作（不是录音会话、任何时候都算的）某个组合的一部分。
 * 长的也是录音会话的不用压：那是升级，悬浮条把这一次直接换过去，录音不断
 * @param {Record<string, string[][]>} chords 每个动作装着的组合（hotkeys/bindings.mjs 的 resolveHotkeys 的 chords）
 * @returns {Set<string>}
 */
export function gatedBindings(chords) {
  const longer = ACTIONS.filter((action) => action.handler !== "session" && action.when === "always").flatMap(
    (action) => chords[action.id] ?? [],
  );
  const gated = new Set();
  for (const action of ACTIONS.filter(({ handler }) => handler === "session")) {
    for (const [index, codes] of (chords[action.id] ?? []).entries()) {
      if (longer.some((whole) => isPart(codes, whole))) gated.add(`${action.id}#${index}`);
    }
  }
  return gated;
}

/**
 * @param {object} options
 * @param {(event: object) => void} options.deliver 交出去：小帮手报的绑定事件（binding、interrupted），原样
 * @param {number} [options.holdMs]
 * @param {{ set: typeof setTimeout, clear: typeof clearTimeout }} [options.timers] 测试时换成假的
 */
export function createSessionGate({ deliver, holdMs = HOLD_MS, timers = { set: setTimeout, clear: clearTimeout } }) {
  let gated = new Set();
  /** 压着的那一下：{ event, timer }；没有是 null */
  let held = null;

  function drop() {
    if (held) timers.clear(held.timer);
    held = null;
  }

  function release() {
    const { event } = held;
    drop();
    deliver(event);
  }

  return {
    /** 换了一份热键：按它重算要压的；压着的那一下丢掉（它对应的组合可能已经不在了） */
    setChords(chords) {
      drop();
      gated = gatedBindings(chords);
    },

    /** 小帮手换了（重查权限、退出）：压着的那一下丢掉，新的小帮手不会再报它的松开 */
    reset() {
      drop();
    },

    /** 小帮手报的一个绑定事件 */
    accept(event) {
      if (held && event.id === held.event.id) {
        // 被打断：凑成了别的组合（划词、语音翻译），或者是别的组合键。悬浮条没看见按下，打断也不用给它
        if (event.event === "interrupted") drop();
        // 松开：一次点按，连着按下交出去
        else if (event.event === "binding" && !event.down) {
          release();
          deliver(event);
        }
        return;
      }
      if (event.event === "binding" && event.down && gated.has(event.id) && actionOfBinding(event.id) !== null) {
        drop();
        held = { event, timer: timers.set(() => release(), holdMs) };
        return;
      }
      deliver(event);
    },
  };
}
