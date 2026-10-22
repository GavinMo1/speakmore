import { msg } from "../i18n/index.mjs";
import { ACTIONS, actionName, MAX_CHORDS } from "./actions.mjs";
import { chordString, chordText, keyName } from "./chord.mjs";
import { availableOn, isModifier, keyOf } from "./keys.mjs";

// 一个组合在这个系统上能不能绑、要不要提醒，以及一整份绑定合不合（docs/hotkey-research.md 5.5）。
// 写法和形状已经由 chord.mjs 的 parseChord 查过，这里拿到的都是规整过的 code 数组。
// 规矩是"敢做减法"：和系统、各应用通用的快捷键撞的一律不让绑，宁可少开放几个键，也不要绑上以后到处误触发、
// 或者把系统的功能吞掉。别的应用自己注册的快捷键没有通用接口能查，只能靠这里的表加提醒。

const CONTROL = ["ControlLeft", "ControlRight"];
const ALT = ["AltLeft", "AltRight"];
const SHIFT = ["ShiftLeft", "ShiftRight"];
const META = ["MetaLeft", "MetaRight"];
const LEFT = ["ControlLeft", "AltLeft", "ShiftLeft", "MetaLeft"];

const kindOf = (code) => keyOf(code).kind;
const has = (codes, family) => codes.some((code) => family.includes(code));
const typing = (codes) => codes.some((code) => kindOf(code) === "typing");
const fKeys = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `F${from + i}`);
const only = (codes, ...wanted) => codes.length === wanted.length && wanted.every((family) => has(codes, family));

/** 两个系统各自不让绑的：一条一条按顺序查，第一条对上的就是原因 */
const SYSTEM_RULES = {
  darwin: [
    // fn 按着按 F 键就是那个 F 键（MacBook 第一排要按着 fn 才是 F 键）：小帮手匹配时把 fn 去掉，绑成 fn+F5 永远对不上。
    // 录键时 record.mjs 已经折掉了，这条拦的是命令行、环境变量、手改文件
    [(codes) => codes.includes("Fn") && codes.some((code) => /^F\d+$/.test(code)), "binding.macFnFKey"],
    // ⌘ 加打字的键：拷贝、粘贴、保存、切标签页（⌘1）、切窗口（⌘`）……几乎全被占了
    [(codes) => has(codes, META) && typing(codes), "binding.macCommandTyping"],
    // ⌃ 加打字的键：⌃空格切输入法，⌃A ⌃E ⌃K 是文本框里挪光标、删行，终端里 ⌃C 是中断
    [(codes) => has(codes, CONTROL) && typing(codes), "binding.macControlTyping"],
    // 地球仪键加字母是系统的快捷键（地球仪 E 表情、F 全屏、C 控制中心……）；fn+空格不在其中
    [(codes) => codes.includes("Fn") && typing(codes) && !codes.includes("Space"), "binding.macFnTyping"],
    // ⌃F1–F8 是键盘导航（打开全键盘控制、聚焦菜单栏、程序坞、工具栏……）
    [(codes) => has(codes, CONTROL) && has(codes, fKeys(1, 8)), "binding.macControlF"],
    // ⌘F5 开关旁白，⌘F1 镜像显示器
    [(codes) => has(codes, META) && has(codes, fKeys(1, 12)), "binding.macCommandF"],
    [(codes) => codes.length === 1 && codes[0] === "F11", "binding.macF11"],
  ],
  win32: [
    // Win 单按开开始菜单，Win 加字母、数字、方向键、空格都是系统的
    [(codes) => has(codes, META), "binding.winMeta"],
    [(codes) => has(codes, CONTROL) && typing(codes), "binding.winControlTyping"],
    // 左 Alt+空格打开窗口菜单。右 Alt+空格不拦：语音翻译的默认键就是它（Typeless 的 Windows 默认键里也有它），
    // 小帮手吞掉空格，窗口菜单不弹（10-22 在 Windows 开发机的记事本里验过，docs/hotkey-research.md V27）
    [(codes) => only(codes, ["AltLeft"], ["Space"]), "binding.winAltSpace"],
    [(codes) => only(codes, ALT, ["F4"]) || only(codes, CONTROL, ["F4"]), "binding.winCloses"],
    // 默认的输入语言热键是左 Alt+Shift，切换键盘布局是 Ctrl+Shift（设置 › 时间和语言 › 输入 › 高级键盘设置）
    [(codes) => only(codes, SHIFT, CONTROL) || only(codes, SHIFT, ALT), "binding.winShiftSwitch"],
    [(codes) => only(codes, SHIFT, ["F10"]), "binding.winShiftF10"],
    // 单独的 F12 留给调试器（RegisterHotKey 文档；开发机上试登记一律报 1409），录键时也会被说成"被别的程序占用"
    [(codes) => codes.length === 1 && codes[0] === "F12", "binding.winF12"],
  ],
};

/** 能绑但要提醒的 */
const WARNING_RULES = {
  darwin: [
    [(codes) => codes.length === 1 && codes[0] === "Fn", "binding.fnSystem"],
    [(codes) => has(codes, ALT) && typing(codes), "binding.macOptionTyping"],
  ],
  win32: [
    [(codes) => codes.includes("AltRight"), "binding.altGr"],
    [(codes) => has(codes, ALT) && codes.some((code) => /^Key[A-Z]$/.test(code)), "binding.winAltLetter"],
  ],
};

const platformOf = (platform) => (platform === "win32" ? "win32" : "darwin");

/**
 * 一个组合给这个动作、在这个系统上能不能绑。能绑是 null，不能绑是原因（一句还没定语言的话）
 * @param {string[]} codes 规整过的组合
 * @param {{ action: (typeof ACTIONS)[number], platform: string }} options
 */
export function rejectReason(codes, { action, platform }) {
  const os = platformOf(platform);
  const missing = codes.find((code) => !availableOn(code, os));
  if (missing !== undefined) return msg("binding.notAvailable", { key: keyName(missing) });

  if (action.when === "capturing") {
    // 只在说话时生效的动作只按自己那一个键认（5.3），所以只能是单个非修饰键
    if (codes.length !== 1 || isModifier(codes[0]))
      return msg("binding.capturingSingle", { action: actionName(action) });
  } else if (codes.length === 1 && kindOf(codes[0]) === "escape") {
    return msg("binding.escapeOnlyCapturing");
  }

  for (const [matches, reason] of SYSTEM_RULES[os]) {
    if (matches(codes)) return msg(reason);
  }
  // 只有左边修饰键的：⌘C、⇧⌘Z、Ctrl+C、Alt+Tab 都从它按起，按下就开始录音的话，平时用快捷键会频繁误触发。
  // 带普通键的组合（左⌥空格）、有右边修饰键或 fn 的不算
  if (codes.every((code) => LEFT.includes(code))) return msg("binding.leftOnly");
  return null;
}

/**
 * 能绑但要提醒的，一句还没定语言的话一条
 * @param {string[]} codes
 * @param {{ platform: string }} options
 */
export function warningsOf(codes, { platform }) {
  return WARNING_RULES[platformOf(platform)].filter(([matches]) => matches(codes)).map(([, reason]) => msg(reason));
}

const isPart = (part, whole) => part.length < whole.length && part.every((code) => whole.includes(code));

/**
 * 一整份绑定合不合：每个组合各查一遍（rejectReason、warningsOf），再查动作之间和一个动作内部。
 * 动作之间撞了是先到先得，按 bindings 里写的先后：后来的让位。存设置时把要改的那个动作放在最后，撞了就是它不能存；
 * 下发之前把用户自己绑的放在前面，新动作的默认组合撞上了就是它不装（5.4）。
 * 拒绝的组合每个只报第一个原因；能绑的再报它的提醒。按 bindings 的先后、每个动作内按组合的先后报。
 * @param {Record<string, string[][]>} bindings 动作 id → 组合列表（规整过的 code 数组）；目录里没有的 id 不管，
 *   目录里有、这里没写的动作不查
 * @param {string} platform
 * @returns {Array<{ action: string, index: number, level: "reject" | "warn", reason: object }>}
 */
export function checkBindings(bindings, platform) {
  const problems = [];
  const report = (action, index, level, reason) => problems.push({ action: action.id, index, level, reason });
  const listed = Object.keys(bindings)
    .map((id) => ACTIONS.find((action) => action.id === id))
    .filter(Boolean);
  // 已经认下来的组合：规整写法 → 哪个动作
  const taken = new Map();
  const accepted = [];
  // 只在说话时生效的动作认下来的键，和别的动作认下来的多键组合里的键：两边不能有同一个，不然说话时按那个组合只会取消
  const capturingKeys = new Map();
  const comboKeys = new Map();

  for (const action of listed) {
    const chords = bindings[action.id];
    if (chords.length === 0 && !action.clearable) {
      report(action, 0, "reject", msg("binding.required", { action: actionName(action) }));
    }
    // 这个动作的第 index 个组合为什么不能要；能要是 null
    const rejectionOf = (codes, index) => {
      if (index >= MAX_CHORDS) return msg("binding.tooMany", { count: MAX_CHORDS });
      const own = rejectReason(codes, { action, platform });
      if (own !== null) return own;
      const holder = taken.get(chordString(codes));
      if (holder === action) return msg("binding.repeated");
      if (holder !== undefined) return msg("binding.taken", { action: actionName(holder) });
      if (action.when === "capturing") {
        const user = comboKeys.get(codes[0]);
        if (user === undefined) return null;
        return msg("binding.capturingKeyUsed", { key: keyName(codes[0]), action: actionName(user) });
      }
      // 和取消那一个键一模一样的，归到上面的"已经给了"：那是重复，不是组合里夹带了它
      if (codes.length === 1) return null;
      const clash = codes.find((code) => capturingKeys.has(code));
      if (clash === undefined) return null;
      return msg("binding.usesCapturingKey", { key: keyName(clash), action: actionName(capturingKeys.get(clash)) });
    };
    for (const [index, codes] of chords.entries()) {
      const rejection = rejectionOf(codes, index);
      if (rejection !== null) {
        report(action, index, "reject", rejection);
        continue;
      }
      taken.set(chordString(codes), action);
      accepted.push({ action, index, codes });
      if (action.when === "capturing") capturingKeys.set(codes[0], action);
      else if (codes.length > 1) for (const code of codes) if (!comboKeys.has(code)) comboKeys.set(code, action);
    }
  }

  for (const { action, index, codes } of accepted) {
    for (const reason of warningsOf(codes, { platform })) report(action, index, "warn", reason);
    for (const other of accepted) {
      // 两个都是录音会话（语音输入和语音翻译）时不提醒：按长的那个时，悬浮条把已经开始的这一次直接升级过去，录音不断
      if (isPart(codes, other.codes) && !(action.handler === "session" && other.action.handler === "session")) {
        report(
          action,
          index,
          "warn",
          msg("binding.prefix", { action: actionName(other.action), chord: chordText(other.codes) }),
        );
      }
    }
  }
  const order = (problem) => listed.findIndex((action) => action.id === problem.action) * 1000 + problem.index;
  // 同一个组合的：拒绝在前，提醒在后；sort 是稳定的，同一级里保持上面报的先后
  return problems.sort((a, b) => order(a) - order(b) || (a.level === b.level ? 0 : a.level === "reject" ? -1 : 1));
}

/** 系统设置里"按下地球仪键时"各个值是做什么（AppleFnUsageType；0 是无操作） */
const FN_USES = { 1: "binding.fnUses.inputSource", 2: "binding.fnUses.emoji", 3: "binding.fnUses.dictation" };

/**
 * 存的时候的一条提醒，按小帮手问来的系统设置说具体（docs/hotkey-research.md 5.8 的 info）：单按地球仪键的那条，
 * 系统里设成"无操作"的就不提醒（null），设了别的就点明会一起做什么；读不到、不认识的值照原样说。别的提醒原样返回
 * @param {object} warning 一句还没定语言的话；可以是 hotkeySetting.problem 包着的（前面带着是哪个组合）
 * @param {{ fnUsage?: number }} info
 */
export function refineWarning(warning, { fnUsage } = {}) {
  const wrapped = warning?.key === "hotkeySetting.problem";
  const reason = wrapped ? warning.params.reason : warning;
  if (reason?.key !== "binding.fnSystem" || !Number.isInteger(fnUsage)) return warning;
  if (fnUsage === 0) return null;
  if (!Object.hasOwn(FN_USES, fnUsage)) return warning;
  const refined = msg("binding.fnSystemUse", { use: msg(FN_USES[fnUsage]) });
  return wrapped ? msg("hotkeySetting.problem", { ...warning.params, reason: refined }) : refined;
}
