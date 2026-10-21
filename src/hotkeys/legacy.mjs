// 0.13 以前热键存的是一个 id，只能是单独一个修饰键。全仓只有这里认这些 id：读设置文件、环境变量 SPEAKMORE_HOTKEY、
// 命令行 config set hotkey 的时候换成组合，存下来的、报出去的、显示的都是新写法（docs/hotkey-research.md 5.9）。
// Mac 的右 Control 和 Windows 的右 Ctrl 是同一个位置的键，两个 id 换成同一个组合。

/** 旧 id → [组合, 它是哪个系统的] */
const TABLE = {
  right_option: ["AltRight", "darwin"],
  right_command: ["MetaRight", "darwin"],
  right_control: ["ControlRight", "darwin"],
  fn: ["Fn", "darwin"],
  right_alt: ["AltRight", "win32"],
  right_ctrl: ["ControlRight", "win32"],
};

export const LEGACY_HOTKEYS = Object.freeze(
  Object.fromEntries(Object.entries(TABLE).map(([id, [chord]]) => [id, chord])),
);

/** 旧 id 对应的组合；不是旧 id 就是 null */
export const legacyChord = (id) => (Object.hasOwn(TABLE, id) ? TABLE[id][0] : null);

/**
 * 反过来：听写的组合正好是这个系统的一个旧键时给旧 id，别的是 null。
 * 只给 status --json 里留一个版本的旧字段 hotkey、settings.hotkey 用（D13），0.15 删
 * @param {string[][]} chords 听写的组合列表
 * @param {string} platform
 */
export function legacyIdOf(chords, platform) {
  if (chords.length !== 1 || chords[0].length !== 1) return null;
  const system = platform === "win32" ? "win32" : "darwin";
  const found = Object.entries(TABLE).find(([, [chord, of]]) => chord === chords[0][0] && of === system);
  return found ? found[0] : null;
}
