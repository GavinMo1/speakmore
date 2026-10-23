// 听写的状态机，纯函数：给当前状态和一个事件，得到新状态和要执行的动作。
// 照原版 2.8.1 的单击流程做（docs/10-interaction-state-machine.md）：
// 按一下热键开始，再按一下结束；按住超过 LONG_PRESS_MS 取消（这一版不支持按住说话）。
// 说话的时候可以取消（按取消的键或点悬浮条上的 ✕），点 ✓ 等于再按一下热键。
// 原版的热键是 fn，这里是哪个键由主进程决定，状态机不关心。
// 录音会话的动作不止一个（语音输入、语音翻译），状态里记着这一次是哪个（action）。按着语音输入的键又按了空格
// 凑成语音翻译的组合时，小帮手报"升级"（docs/hotkey-research.md D2）：这一次直接换成语音翻译，录音不断。

import { actionOf } from "../../hotkeys/actions.mjs";
import { msg } from "../../i18n/index.mjs";

/** 按住超过这么久算"按住"、这次作废：动作目录里语音输入的 longPressMs */
export const LONG_PRESS_MS = actionOf("dictate").longPressMs;

const CLICKS = Object.freeze({ cancel: "USER_CANCEL", confirm: "USER_CONFIRM" });

/** 升级到的那个动作也是录音会话：这一次换成它，录音不断 */
const upgradesToSession = (input) => actionOf(input.to)?.handler === "session";

/**
 * 动作目录里的处理者（handler）各认哪些输入：session 是这一次录音（按下、松开、被打断、升级），cancel 只看按下。
 * 被打断时带着 to 的是升级（主进程认出来的动作 id）：升级到另一个录音会话是 SWITCH，升级到别的、或者没有 to 都是作废
 */
const HANDLERS = Object.freeze({
  session: (input) => {
    if (input.event === "interrupted") return upgradesToSession(input) ? "SWITCH" : "OTHER_KEY";
    return input.down ? "KEY_DOWN" : "KEY_UP";
  },
  cancel: (input) => (input.event === "binding" && input.down ? "USER_CANCEL" : null),
});

/**
 * 主进程转来的一个输入 → 状态机的事件类型。输入是小帮手报的绑定事件，主进程认出是哪个动作后带上 action：
 * { event: "binding", action, down }、{ event: "interrupted", action }；或者悬浮条上的点击 { event: "click", id }。
 * 这一下不用管的是 null；认不出来的是 undefined
 */
export function eventTypeOf(input) {
  if (input?.event === "click") return Object.hasOwn(CLICKS, input.id) ? CLICKS[input.id] : undefined;
  if (input?.event !== "binding" && input?.event !== "interrupted") return undefined;
  const action = actionOf(input.action);
  return action === null ? undefined : HANDLERS[action.handler](input);
}

export const Phase = Object.freeze({
  IDLE: "idle",
  STARTING: "starting", // 已按下，麦克风还没就绪
  RECORDING: "recording",
  FINISHING: "finishing", // 已结束录音，等成品
  ERROR: "error",
});

export const Action = Object.freeze({
  START: "start", // 打开麦克风、连服务端
  CANCEL: "cancel", // 丢弃这次录音
  STOP: "stop", // 结束录音并要成品
  ARM_HOLD_TIMER: "arm_hold_timer",
  CLEAR_HOLD_TIMER: "clear_hold_timer",
  SWITCH: "switch", // 这一次换成另一个录音会话的动作（state.action），录音不断
});

/**
 * held：热键从"开始这次录音的那一下"起一直没松开。松开之前还不确定是单击，
 * 可能是长按，也可能是热键加别的键的组合键。
 * message：出错原因或给用户的提示，只在 error 和带提示回到 idle 时有。
 * action：这一次是哪个录音会话的动作（dictate、translate），空闲时是 null。
 * switched：刚升级过：紧跟着会来新动作自己的按下，那一下是升级的同一次按键，不是"再按一下"
 */
export const initialState = Object.freeze({
  phase: Phase.IDLE,
  held: false,
  message: null,
  action: null,
  switched: false,
});

const idle = (message = null) => ({ ...initialState, message });
const unchanged = (state) => ({ state, actions: [] });

export function transition(state, event) {
  const { phase, held } = state;
  switch (event.type) {
    case "KEY_DOWN":
      if (phase === Phase.IDLE || phase === Phase.ERROR) {
        return {
          state: { ...initialState, phase: Phase.STARTING, held: true, action: event.action ?? null },
          actions: [Action.START, Action.ARM_HOLD_TIMER],
        };
      }
      // 升级到的那个动作自己的按下：和升级是同一次按键
      if (state.switched && event.action === state.action) return unchanged({ ...state, switched: false });
      // 不看 held：万一上一次松开的事件丢了，再按一下也要能结束，不能卡在录音里
      if (phase === Phase.RECORDING) {
        return { state: { ...state, phase: Phase.FINISHING, held: false, switched: false }, actions: [Action.STOP] };
      }
      // 麦克风还没就绪就按了第二下：什么都没录到，直接作罢
      if (phase === Phase.STARTING && !held) return { state: idle(), actions: [Action.CANCEL] };
      return unchanged(state);

    case "KEY_UP":
      if (!held) return unchanged(state);
      return { state: { ...state, held: false, switched: false }, actions: [Action.CLEAR_HOLD_TIMER] };

    case "SWITCH":
      // 按着热键又按了别的键，凑成另一个录音会话的组合：这一次换成它，按住的计时照旧（按满了照样作废）。
      // 已经不在说话了（被拦下没开始、已经在等成品）就不管，紧跟着的那个按下照常处理
      if (!held || (phase !== Phase.STARTING && phase !== Phase.RECORDING)) return unchanged(state);
      return { state: { ...state, action: event.to, switched: true }, actions: [Action.SWITCH] };

    case "OTHER_KEY":
      // 热键还按着就来了别的键，说明用户按的是组合键（比如 Option+字母），不是听写
      if (!held) return unchanged(state);
      return { state: idle(), actions: [Action.CANCEL, Action.CLEAR_HOLD_TIMER] };

    case "LONG_HOLD":
      if (!held) return unchanged(state);
      return { state: idle(msg("bar.noHold")), actions: [Action.CANCEL] };

    case "USER_CANCEL":
      // 用户不要这一次了。等成品时已经取消不了：录音已经交出去了
      if (phase !== Phase.STARTING && phase !== Phase.RECORDING) return unchanged(state);
      return { state: idle(), actions: [Action.CANCEL, Action.CLEAR_HOLD_TIMER] };

    case "USER_CONFIRM":
      if (phase !== Phase.RECORDING) return unchanged(state);
      return { state: { ...state, phase: Phase.FINISHING, held: false, switched: false }, actions: [Action.STOP] };

    case "MIC_READY":
      return phase === Phase.STARTING ? unchanged({ ...state, phase: Phase.RECORDING }) : unchanged(state);

    case "MAX_DURATION":
      if (phase !== Phase.RECORDING) return unchanged(state);
      return { state: { ...state, phase: Phase.FINISHING, held: false, switched: false }, actions: [Action.STOP] };

    case "RESULT":
      // message 在这里是给用户的提示，比如"没有听到声音""已复制，请按 ⌘V"
      return phase === Phase.FINISHING ? unchanged(idle(event.message ?? null)) : unchanged(state);

    case "FAILED": {
      if (phase === Phase.IDLE || phase === Phase.ERROR) return unchanged(state);
      const next = { ...initialState, phase: Phase.ERROR, message: event.message };
      // 等成品时出错，录音已经停了；其余阶段要把麦克风和定时器收掉
      const actions = phase === Phase.FINISHING ? [] : [Action.CANCEL, Action.CLEAR_HOLD_TIMER];
      return { state: next, actions };
    }

    default:
      throw new Error(`状态机不认识的事件：${event.type}`);
  }
}
