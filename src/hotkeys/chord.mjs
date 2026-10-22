import { alternatives, LocalizedError, msg } from "../i18n/index.mjs";
import { isModifier, keyOf, MODIFIER_ORDER, SHIFTS } from "./keys.mjs";

// 一个组合：最多两个键，写成 "ControlRight+Space"（docs/hotkey-research.md 5.2）。
// 这里管写法、形状（5.3）和怎么显示（5.7）；哪个系统上能不能绑、和系统的快捷键、和别的动作冲不冲突在 validate.mjs。
// 显示的话都是还没定语言的 msg：分系统的写法（Mac 空一格、Windows 用加号；右 Option / 右 Alt）由文案的 windows 一节管。

export const MAX_KEYS = 2;

const rank = (code) => {
  const index = MODIFIER_ORDER.indexOf(code);
  return index === -1 ? MODIFIER_ORDER.length : index;
};

/** 按显示顺序排：修饰键在前（fn、Control、Option、Shift、Command），普通键最后 */
export const sortChord = (codes) => [...codes].sort((a, b) => rank(a) - rank(b));

/** 规整后的写法 */
export const chordString = (codes) => sortChord(codes).join("+");

const fail = (key, params) => {
  throw new LocalizedError(msg(key, params));
};

/** 一个键叫什么，嵌进句子用（右 Option 键、F13 键） */
export const keyName = (code) => {
  const label = keyOf(code)?.label;
  return label === undefined ? msg(`keys.${code}.name`) : msg("keys.named", { label });
};
/** 组合里的一个键怎么叫（右 Option、空格、F13） */
const keyShort = (code) => keyOf(code)?.label ?? msg(`keys.${code}.short`);
/** 一个键的键帽（右⌥、空格、F13） */
const keycap = (code) => keyOf(code)?.label ?? msg(`keys.${code}.keycap`);

/**
 * "Space+ControlRight" → ["ControlRight", "Space"]。认不出的键、超过两个键、形状不行（5.3）都抛 LocalizedError
 * @param {string} text
 * @returns {string[]}
 */
export function parseChord(text) {
  const codes = String(text)
    .split("+")
    .map((code) => code.trim());
  if (codes.length === 1 && codes[0] === "") fail("chord.empty");
  if (codes.length > MAX_KEYS) fail("chord.tooMany");
  for (const code of codes) {
    if (keyOf(code) === null) fail("chord.unknown", { code: JSON.stringify(code) });
  }
  if (new Set(codes).size !== codes.length) fail("chord.twice", { key: keyName(codes[0]) });
  for (const code of codes) {
    if (keyOf(code).kind === "blocked") fail("chord.blocked", { key: keyName(code) });
  }

  const [first, second] = sortChord(codes);
  const kindOf = (code) => keyOf(code).kind;
  if (second === undefined) {
    if (kindOf(first) === "typing") fail("chord.typingAlone", { key: keyName(first) });
    // 微软拼音单按 Shift 切中英文，连按还可能弹出粘滞键（D11）
    if (SHIFTS.includes(first)) fail("chord.shiftAlone");
    return [first];
  }
  // 排过序：两个里有修饰键的话，它一定在前面
  if (!isModifier(first)) fail("chord.twoPlain");
  if (kindOf(second) === "escape") fail("chord.escapeCombo");
  if (SHIFTS.includes(first) && kindOf(second) === "typing") fail("chord.shiftTyping");
  return [first, second];
}

/** 嵌进句子的名字：单键是那个键的名字（右 Option 键），两个键用加号连起来（右 Option+空格） */
export function chordName(codes) {
  const [first, second] = sortChord(codes);
  if (second === undefined) return keyName(first);
  return msg("chord.named", { first: keyShort(first), second: keyShort(second) });
}

/** 纯文字（菜单栏、命令行、通知）：Mac 上键帽之间空一格（右⌥ 空格），Windows 上用加号（右 Alt+空格） */
export function chordText(codes) {
  const [first, second] = sortChord(codes);
  if (second === undefined) return keycap(first);
  return msg("chord.text", { first: keycap(first), second: keycap(second) });
}

/** 一个动作的几个组合嵌进句子：任一个都行，按"或"并列（地球仪（fn）键、右 Command 键） */
export const chordsName = (chords) => alternatives(chords.map(chordName));
/** 一个动作的几个组合写成纯文字（fn、右⌘） */
export const chordsText = (chords) => alternatives(chords.map(chordText));

/** 键帽，一个键一个，按显示顺序。悬浮条、首页、设置页画成一排 */
export const chordKeycaps = (codes) => sortChord(codes).map(keycap);
