import { FEATURES } from "./flow.mjs";

// 快捷键那一步怎么认出"按到了"。两路都认：
//   窗口自己收到的按键（DOM 的 keydown、keyup）：Mac 上还没开输入监控时只有这一路，查的是键按不按得到、有没有被别的软件截走；
//   小帮手转来的（主进程的 onboarding:hotkey）：小帮手听得到键时，空格、回车会被它吞掉，窗口收不全，要看它报的是哪个功能。
// 纯函数，不碰页面。

/** 一下手势：从按下第一个键到全部松开，按过的键。两键以内的组合也是这样认的（src/hotkeys 的匹配器同理） */
export function createGesture() {
  /** 正按着的键 */
  const held = new Set();
  /** 这一下按过的全部键 */
  let keys = new Set();
  return {
    held,
    down(code) {
      held.add(code);
      keys.add(code);
    },
    /** 松开一个键：全部松开时给出这一下按过的键，没松完（或者根本没按过）是 null */
    up(code) {
      if (!held.delete(code) || held.size > 0) return null;
      const chord = [...keys];
      keys = new Set();
      return chord;
    },
    /** 切走了窗口：按着的都当松开，这一下作废（松开不会再来了） */
    reset() {
      held.clear();
      keys = new Set();
    },
  };
}

const sameChord = (a, b) => a.length === b.length && a.every((code) => b.includes(code));

/**
 * 按的这一下是哪个功能的组合：按集合精确匹配，不分先后；一个功能有几个组合，哪个都算。只认三个功能
 * @param {{ id: string, inEffect: string[][] }[]} actions setup:get 的 hotkeyActions
 * @param {string[]} chord 这一下按过的键
 * @returns {string | null}
 */
export function actionOfChord(actions, chord) {
  const action = actions.find(
    ({ id, inEffect }) => FEATURES.includes(id) && inEffect.some((codes) => sameChord(codes, chord)),
  );
  return action?.id ?? null;
}

/**
 * 小帮手转来的一下算不算按到了：功能的组合松开了、中间没被打断。
 * 按右⌥ 再按空格时，它先报语音输入按下、被打断，再报语音翻译按下、松开：只有语音翻译算
 * @param {{ action: string, event: string, down: boolean }} event
 * @returns {string | null} 按到的功能
 */
export const helperPassed = ({ action, event, down }) =>
  event === "binding" && !down && FEATURES.includes(action) ? action : null;
