import { msg } from "../i18n/index.mjs";
import { ACTIONS, actionName, actionOf, defaultChords } from "./actions.mjs";
import { chordsText, chordText, sortChord } from "./chord.mjs";
import { isModifier, nativeCode } from "./keys.mjs";
import { chordsOf, settingNameOf } from "./settings.mjs";
import { checkBindings } from "./validate.mjs";

// 下发给小帮手的绑定表（docs/hotkey-research.md 5.8）。小帮手不认键名，也不知道有哪些动作：它只拿到 id 和原生码，
// 按下、松开、被打断都只报 id。id 写成"动作#第几个组合"，主进程靠它认回是哪个动作。
// 下发之前再按存设置时那套规矩查一遍（5.2 的第三道）：手改的文件、环境变量、从别的系统搬来的设置都在这里兜住。

/**
 * 一个组合没装上（chord、reason），或者一个必须有键的动作一个都装不上、退回了默认组合（fallback）。
 * 能装但要提醒的也是这个样子（resolveHotkeys 的 warnings）
 * @typedef {{ action: string, chord: string[], reason: object } | { action: string, fallback: string[][] }} HotkeyProblem
 */

/** 按 checkBindings 查一遍，留下没被拒绝的；问题和提醒按组合交出来 */
function screen(bindings, platform) {
  const found = checkBindings(bindings, platform);
  const kept = {};
  const problems = [];
  const warnings = [];
  for (const [id, chords] of Object.entries(bindings)) {
    const rejected = new Set(found.filter((p) => p.action === id && p.level === "reject").map((p) => p.index));
    kept[id] = chords.filter((_, index) => !rejected.has(index));
  }
  for (const { action, index, level, reason } of found) {
    // 整个动作的问题（一个组合都没有）不对应哪个组合：后面按要不要退回默认来说
    if (bindings[action][index] === undefined) continue;
    (level === "reject" ? problems : warnings).push({ action, chord: bindings[action][index], reason });
  }
  return { kept, problems, warnings };
}

/**
 * 按设置算出这一次装哪些组合。装不上的不装、照实交代；必须有键的动作一个都装不上时退回它的默认组合。
 * 用户自己设的排在前面：新动作的默认组合和用户的撞了，以用户的为准（5.4）
 * @param {Record<string, { value: string, source: string }>} settings resolveSettings 的结果（只看 hotkey.* 几项）
 * @param {string} platform
 * @returns {{ chords: Record<string, string[][]>, problems: HotkeyProblem[], warnings: HotkeyProblem[] }}
 *   chords 按动作目录的先后
 */
export function resolveHotkeys(settings, platform) {
  const setting = (action) => settings[settingNameOf(action)];
  const ordered = (actions, chordsFor) =>
    Object.fromEntries(
      [
        ...actions.filter((a) => setting(a).source !== "default"),
        ...actions.filter((a) => setting(a).source === "default"),
      ].map((action) => [action.id, chordsFor(action)]),
    );
  const first = screen(
    ordered(ACTIONS, (action) => chordsOf(setting(action).value)),
    platform,
  );
  const fallen = ACTIONS.filter((action) => !action.clearable && first.kept[action.id].length === 0);
  let { kept, problems, warnings } = first;
  if (fallen.length > 0) {
    // 退回默认的排在最后：它们让位给已经装上的
    const rest = ACTIONS.filter((action) => !fallen.includes(action));
    const second = screen(
      {
        ...ordered(rest, (action) => first.kept[action.id]),
        ...Object.fromEntries(fallen.map((action) => [action.id, defaultChords(action, platform)])),
      },
      platform,
    );
    kept = second.kept;
    // 默认组合也装不上的（比如取消的 esc 被用户自己的组合占了）不说"先用默认的"：它一个键都没有，原因在第二轮的问题里。
    // 两轮查出的同一条只留一条
    const seen = new Set();
    problems = [
      ...problems,
      ...fallen
        .filter((action) => second.kept[action.id].length > 0)
        .map((action) => ({ action: action.id, fallback: second.kept[action.id] })),
      ...second.problems,
    ].filter((problem) => {
      const key = JSON.stringify(problem);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    warnings = second.warnings;
  }
  return { chords: Object.fromEntries(ACTIONS.map((action) => [action.id, kept[action.id]])), problems, warnings };
}

/**
 * 小帮手说装不上的原因（bound 回执，5.8）→ 人话。needs_listen 不在这里：没有输入监控权限另有一条，不重复报。
 * 说话时才生效的动作（取消）报 needs_trusted 的也不算：没有辅助功能权限时本来就截不住，悬浮条那时也不画取消按钮，
 * 少了什么由"打了折扣"那句说（setup-state.mjs 的 degraded）
 */
const BOUND_REASONS = {
  needs_trusted: "hotkeyProblem.needsTrusted",
  register_failed: "hotkeyProblem.registerFailed",
  invalid: "hotkeyProblem.invalid",
};

/**
 * 小帮手的 bound 回执里装不上的几个，按绑定 id 认回是哪个动作的哪个组合
 * @param {Array<{ id: string, reason: string }>} rejected
 * @param {Record<string, string[][]>} chords 下发的那一份（resolveHotkeys 的 chords），绑定 id 的序号按它数
 * @returns {HotkeyProblem[]} 认不回来的（不该有）不在里面，由调用方记日志
 */
export function boundProblems(rejected, chords) {
  return rejected.flatMap(({ id, reason }) => {
    const action = actionOfBinding(id);
    const chord = action && chords[action.id]?.[Number(id.split("#")[1])];
    if (!chord || !Object.hasOwn(BOUND_REASONS, reason)) return [];
    if (reason === "needs_trusted" && action.when === "capturing") return [];
    return [{ action: action.id, chord, reason: msg(BOUND_REASONS[reason]) }];
  });
}

/** 一条问题或提醒怎么说：放进"还差什么"（setup-state.mjs）、写进日志 */
export function describeHotkeyProblem(problem) {
  const action = actionName(actionOf(problem.action));
  if (problem.fallback) {
    return msg("hotkeyProblem.fallback", { action, chord: chordsText(problem.fallback) });
  }
  return msg("hotkeyProblem.chord", { action, chord: chordText(problem.chord), reason: problem.reason });
}

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
