import { chordKeycaps } from "../../hotkeys/chord.mjs";
import { h } from "./dom.mjs";
import { t } from "./i18n.mjs";

// 键帽（docs/hotkey-research.md 5.7）：一个组合一排，一个键一块，键帽之间不写加号。首页、设置页、引导页都用这里画，
// 文字由 src/hotkeys/chord.mjs 定（右⌥、空格、Windows 上的右 Alt），按界面语言写

/** 一个组合的一排键帽 */
export const keycapRow = (codes, className = "keycap") =>
  chordKeycaps(codes).map((cap) => h("kbd", { class: className, text: t.text(cap) }));

/** 一个动作的几个组合：每个一排键帽，中间按这种语言的"或"隔开（fn 或 右⌘） */
export function keycapGroups(chords) {
  const groups = chords.map((codes) => h("span", { class: "keycaps" }, ...keycapRow(codes)));
  if (groups.length < 2) return groups;
  const parts = new Intl.ListFormat(t.locale, { type: "disjunction" }).formatToParts(groups.map((_, i) => String(i)));
  return parts.map((part) =>
    part.type === "element" ? groups[Number(part.value)] : h("span", { class: "keycaps-or", text: part.value }),
  );
}
