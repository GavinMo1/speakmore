import { msg } from "../i18n/index.mjs";
import { parseChord } from "./chord.mjs";

// 动作目录：有哪些能按快捷键做的事，只有这一张表（docs/hotkey-research.md 5.4）。
// 设置项（hotkey.<动作>）、环境变量、命令行、设置页、引导页、状态、下发给小帮手的绑定表，都按它生成。
// 加一个动作只改三处：这里加一行（两个系统都必须有默认组合，D10）；两份文案里加 actions.<动作>.name 和 description；
// 写它自己的处理代码。有测试按这张表逐个动作查，漏了哪一处会红。
//
// 每行：
//   defaults     默认组合，按系统分，每个组合是 "AltRight+Space" 这样的写法
//   when         always 任何时候；capturing 只在说话时（悬浮条截着 esc 的那段时间）。capturing 的动作只按自己那一个键认，
//                不按集合精确匹配：说话时它一按下就算，不管还按着别的什么（5.3 的"esc 与取消"）
//   clearable    能不能一个组合都不留
//   longPressMs  按住超过这么久算"按住"、这次作废；null 是不管按多久
//   handler      交给谁：session 悬浮条的录音会话（按下、松开、被打断），cancel 悬浮条的取消
//   legacyName、legacyEnv  0.13 以前这一项设置叫什么、环境变量叫什么，入口照样认（5.9）

export const ACTIONS = Object.freeze([
  Object.freeze({
    id: "dictate",
    defaults: Object.freeze({ darwin: Object.freeze(["AltRight"]), win32: Object.freeze(["AltRight"]) }),
    when: "always",
    clearable: false,
    longPressMs: 600,
    handler: "session",
    legacyName: "hotkey",
    legacyEnv: "SPEAKMORE_HOTKEY",
  }),
  Object.freeze({
    id: "cancel",
    defaults: Object.freeze({ darwin: Object.freeze(["Escape"]), win32: Object.freeze(["Escape"]) }),
    when: "capturing",
    clearable: false,
    longPressMs: null,
    handler: "cancel",
  }),
]);

/** 一个动作最多几个组合（D4，同 Typeless） */
export const MAX_CHORDS = 4;

/** 这个 id 的动作；不认识的是 null */
export const actionOf = (id) => ACTIONS.find((action) => action.id === id) ?? null;

/** 动作的名字：一句还没定语言的话 */
export const actionName = (action) => msg(`actions.${action.id}.name`);

/** 这个系统上的默认组合，每个是规整过的 code 数组 */
export const defaultChords = (action, platform) =>
  (action.defaults[platform === "win32" ? "win32" : "darwin"] ?? []).map(parseChord);
