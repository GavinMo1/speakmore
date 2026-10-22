import { msg } from "../i18n/index.mjs";
import { MAX_KEYS, sortChord } from "./chord.mjs";
import { codeOfNative } from "./keys.mjs";

// 录键的定稿规则（docs/hotkey-research.md 5.6）。小帮手在录键模式里只报"现在按着哪些原生码"，什么时候定、定成什么在这里：
// 按住的键数第一次变少时，定成此前按住最多的那一组。两键以内，这和"全部松开时定稿"结果一样，反馈更快。
// 定稿以后要等全部松开才开始下一轮（被拒了的话用户直接重按，还在录）。合不合规矩不在这里查：交给保存时的校验，只有一处说了算。

const F_KEY = /^F([1-9]|1\d|2[0-4])$/;

/** 一份快照（原生码）换成 code；表里没有的记个数 */
function codesOf({ mods = [], keys = [] }, platform) {
  const codes = [];
  let unknown = 0;
  for (const [natives, modifier] of [
    [mods, true],
    [keys, false],
  ]) {
    for (const native of natives) {
      const code = codeOfNative(native, { platform, modifier });
      if (code === null) unknown += 1;
      else codes.push(code);
    }
  }
  return { codes: sortChord(codes), unknown };
}

/** 定稿：认不出的键报错；Mac 上 fn 加 F 键就是那个 F 键（小帮手匹配时也把 fn 去掉，5.3 第 9 条）；单按 esc 是不录了 */
function settle({ codes, unknown }, { platform, cancelable }) {
  if (unknown > 0) return { error: msg("hotkeyRecord.unknownKey") };
  const folded =
    platform !== "win32" && codes.some((code) => F_KEY.test(code)) ? codes.filter((code) => code !== "Fn") : codes;
  if (cancelable && folded.length === 1 && folded[0] === "Escape") return { cancel: true };
  return { codes: folded };
}

/**
 * 一次录键
 * @param {{ platform: string, cancelable: boolean }} options cancelable：单按 esc 算不算"不录了"。录只在说话时生效的动作（取消）时，
 *   esc 本身就是要录的键
 */
export function createRecordRound(options) {
  let last = { codes: [], unknown: 0 };
  // 这一轮定过稿了：全部松开之前再按什么都不算
  let settled = false;
  const size = ({ codes, unknown }) => codes.length + unknown;
  return {
    /**
     * 小帮手报的一份快照
     * @param {{ mods?: number[], keys?: number[] }} snapshot
     * @returns {{ codes: string[], unknown: boolean, tooMany: boolean,
     *   result: null | { codes: string[] } | { cancel: true } | { error: object } }}
     *   codes、unknown、tooMany 是现在按着的（实时显示用）；result 是这一下定下来的
     */
    feed(snapshot) {
      const next = codesOf(snapshot, options.platform);
      let result = null;
      if (!settled && size(next) < size(last)) {
        result = settle(last, options);
        settled = true;
      }
      if (size(next) === 0) settled = false;
      last = next;
      return { codes: next.codes, unknown: next.unknown > 0, tooMany: size(next) > MAX_KEYS, result };
    },
  };
}
