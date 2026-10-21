import { ACTIONS, actionOf } from "./actions.mjs";
import { sortChord } from "./chord.mjs";
import { isModifier, nativeCode } from "./keys.mjs";

// 下发给小帮手的绑定表（docs/hotkey-research.md 5.8）。小帮手不认键名，也不知道有哪些动作：它只拿到 id 和原生码，
// 按下、松开、被打断都只报 id。id 写成"动作#第几个组合"，主进程靠它认回是哪个动作。

/**
 * 一份"动作 → 组合"换成绑定表。组合要先校验过：这里只换码，这个系统上没有的键直接报错
 * @param {Record<string, string[][]>} chords 动作 id → 组合列表（规整过的 code 数组）；目录里没有的动作不出
 * @param {"darwin" | "win32"} platform
 * @returns {Array<{ id: string, mods: number[], key?: number, when: "always" | "capturing" }>}
 */
export function bindingTable(chords, platform) {
  const native = (code) => {
    const value = nativeCode(code, platform);
    if (value === null) throw new RangeError(`${platform} 上没有 ${code} 这个键`);
    return value;
  };
  return ACTIONS.filter((action) => Object.hasOwn(chords, action.id)).flatMap((action) =>
    chords[action.id].map((codes, index) => {
      const sorted = sortChord(codes);
      const key = sorted.find((code) => !isModifier(code));
      return {
        id: `${action.id}#${index}`,
        mods: sorted.filter(isModifier).map(native),
        ...(key === undefined ? {} : { key: native(key) }),
        when: action.when,
      };
    }),
  );
}

/** 小帮手报上来的绑定 id 是哪个动作的；不认识的是 null */
export function actionOfBinding(id) {
  const match = /^([a-z]+)#\d+$/.exec(typeof id === "string" ? id : "");
  return match ? actionOf(match[1]) : null;
}
