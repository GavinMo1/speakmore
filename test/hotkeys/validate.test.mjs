import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIONS, actionOf, defaultChords, MAX_CHORDS } from "../../src/hotkeys/actions.mjs";
import { parseChord } from "../../src/hotkeys/chord.mjs";
import { checkBindings, refineWarning, rejectReason, warningsOf } from "../../src/hotkeys/validate.mjs";
import { createTranslator, msg } from "../../src/i18n/index.mjs";

const en = { darwin: createTranslator("en", "darwin"), win32: createTranslator("en", "win32") };
const dictate = actionOf("dictate");
const cancel = actionOf("cancel");

/** 一个组合在这个系统上被拒的原因（英文），能绑是 null */
const rejected = (text, platform, action = dictate) => {
  const reason = rejectReason(parseChord(text), { action, platform });
  return reason === null ? null : en[platform].text(reason);
};
const warned = (text, platform) => warningsOf(parseChord(text), { platform }).map((w) => en[platform].text(w));

test("动作目录：语音输入和取消；每个动作两个系统都有默认组合（D10），默认组合本身都能绑", () => {
  assert.deepEqual(
    ACTIONS.map((action) => action.id),
    ["dictate", "cancel"],
  );
  for (const action of ACTIONS) {
    for (const platform of ["darwin", "win32"]) {
      const chords = defaultChords(action, platform);
      assert.ok(chords.length >= 1 && chords.length <= MAX_CHORDS, `${action.id} ${platform}`);
      for (const codes of chords)
        assert.equal(rejectReason(codes, { action, platform }), null, `${action.id} ${platform}`);
    }
    const bindings = Object.fromEntries(ACTIONS.map((a) => [a.id, defaultChords(a, "darwin")]));
    assert.deepEqual(checkBindings(bindings, "darwin"), []);
  }
  assert.deepEqual(defaultChords(dictate, "darwin"), [["AltRight"]]);
  assert.deepEqual(defaultChords(dictate, "win32"), [["AltRight"]]);
  assert.deepEqual(defaultChords(cancel, "win32"), [["Escape"]]);
});

test("能绑的（两个系统各自）", () => {
  const mac = [
    "AltRight",
    "MetaRight",
    "ControlRight",
    "Fn",
    "Fn+ShiftLeft",
    "Fn+Space",
    "ControlRight+ShiftRight",
    "AltRight+Space",
    "AltLeft+Space",
    "AltRight+KeyK",
    "ControlRight+F13",
    "MetaRight+F13",
    "F13",
    "F5",
    "ShiftRight+F13",
    "MetaLeft+ShiftRight",
  ];
  for (const text of mac) assert.equal(rejected(text, "darwin"), null, `Mac ${text}`);
  const win = ["AltRight", "ControlRight", "ControlRight+AltRight", "AltRight+KeyK", "ControlRight+F13", "F13", "F5"];
  for (const text of win) assert.equal(rejected(text, "win32"), null, `Windows ${text}`);
});

test("这个系统上没有的键", () => {
  assert.equal(rejected("Fn", "win32"), "Globe (fn) isn't available on this system");
  assert.equal(rejected("ControlRight+F21", "darwin"), "F21 isn't available on this system");
});

test("Mac 上和系统、各应用的快捷键撞的，一律不让绑", () => {
  const cases = {
    "MetaRight+KeyC": "Command with a typing key is an app shortcut (copy, paste, save…)",
    "MetaLeft+Space": "Command with a typing key is an app shortcut (copy, paste, save…)",
    "MetaRight+Digit1": "Command with a typing key is an app shortcut (copy, paste, save…)",
    "ControlRight+Space":
      "Control with a typing key is a system or text-editing shortcut (switching input sources, moving the cursor…)",
    "ControlLeft+KeyA":
      "Control with a typing key is a system or text-editing shortcut (switching input sources, moving the cursor…)",
    "Fn+KeyE": "Globe with a letter, digit or symbol is a system shortcut",
    "Fn+F5": "fn with an F key is just that F key; bind the F key on its own",
    "Fn+F13": "fn with an F key is just that F key; bind the F key on its own",
    "ControlRight+F2": "Control with F1–F8 is a system keyboard-navigation shortcut",
    "ControlRight+F8": "Control with F1–F8 is a system keyboard-navigation shortcut",
    "MetaRight+F5": "Command with F1–F12 is a system shortcut (Command-F5 turns VoiceOver on and off)",
    F11: "F11 is the system's Show Desktop",
  };
  for (const [text, reason] of Object.entries(cases)) assert.equal(rejected(text, "darwin"), reason, text);
  // 这几条只管 Mac
  assert.equal(rejected("ControlRight+F2", "win32"), null);
  assert.equal(rejected("F11", "win32"), null);
});

test("Windows 上和系统、各应用的快捷键撞的，一律不让绑", () => {
  const meta = "The Windows key and its combinations belong to Windows";
  const cases = {
    MetaRight: meta,
    "MetaRight+F13": meta,
    "ControlRight+MetaRight": meta,
    "ControlRight+KeyC": "Ctrl with a typing key is an app shortcut (copy, paste, save…)",
    "ControlRight+Space": "Ctrl with a typing key is an app shortcut (copy, paste, save…)",
    "AltRight+Space": "Alt+Space opens the window menu",
    "AltRight+F4": "This closes the window",
    "ControlRight+F4": "This closes the window",
    "ControlRight+ShiftRight": "Ctrl+Shift and Alt+Shift switch input languages and keyboard layouts",
    "AltRight+ShiftLeft": "Ctrl+Shift and Alt+Shift switch input languages and keyboard layouts",
    "ShiftRight+F10": "Shift+F10 opens the context menu",
    F12: "Windows reserves F12 on its own for debuggers",
  };
  for (const [text, reason] of Object.entries(cases)) assert.equal(rejected(text, "win32"), reason, text);
  // Mac 上这几个是可以的
  assert.equal(rejected("ControlRight+ShiftRight", "darwin"), null);
  assert.equal(rejected("MetaRight", "darwin"), null);
});

test("只有左边修饰键的单键和组合：平时按快捷键先碰到它，会跟着触发", () => {
  const mac =
    "Everyday shortcuts start with left-hand modifiers (Command-C, Shift-Command-Z), so this would fire by accident all the time: use a right-hand modifier, or add fn";
  for (const text of ["MetaLeft", "ControlLeft", "AltLeft", "ShiftLeft+MetaLeft", "ControlLeft+AltLeft"]) {
    assert.equal(rejected(text, "darwin"), mac, `Mac ${text}`);
  }
  const win =
    "Everyday shortcuts start with left-hand modifiers (Ctrl+C, Alt+Tab), so this would fire by accident all the time: use a right-hand modifier";
  for (const text of ["ControlLeft", "AltLeft", "ControlLeft+AltLeft"]) {
    assert.equal(rejected(text, "win32"), win, `Windows ${text}`);
  }
  // 有右边的、有 fn 的、带普通键的都行
  for (const text of ["MetaLeft+ShiftRight", "Fn+ShiftLeft", "AltLeft+Space", "ControlLeft+F13"]) {
    assert.equal(rejected(text, "darwin"), null, `Mac ${text}`);
  }
});

test("单按 esc 只给说话时才生效的动作；取消只能绑一个非修饰键", () => {
  assert.equal(rejected("Escape", "darwin", dictate), "esc on its own is only for actions that work while you talk");
  assert.equal(rejected("Escape", "darwin", cancel), null);
  assert.equal(rejected("F13", "darwin", cancel), null);
  assert.equal(rejected("ContextMenu", "win32", cancel), null);
  const single = "Cancel takes a single key that isn't a modifier (an F key, the Menu key or esc)";
  assert.equal(rejected("AltRight", "darwin", cancel), single);
  assert.equal(rejected("AltRight+Space", "darwin", cancel), single);
});

test("提醒（照样能存）", () => {
  assert.deepEqual(warned("Fn", "darwin"), [
    "If the Globe key has another job in System Settings (switching input sources, emoji, dictation), that fires too; most external keyboards have no fn",
  ]);
  assert.deepEqual(warned("AltRight+KeyK", "darwin"), [
    "Option with a typing key normally types a special character (Option-Space is a non-breaking space); bound, it no longer will",
  ]);
  assert.deepEqual(warned("AltRight", "win32"), [
    "Some keyboard layouts (German, French…) use Right Alt as AltGr for typing; pressing it fires this too",
  ]);
  assert.deepEqual(warned("AltLeft+KeyF", "win32"), [
    "Alt with a letter normally opens an app's menu (Alt+F for File); bound, it no longer will",
  ]);
  assert.deepEqual(warned("ControlRight", "darwin"), []);
  assert.deepEqual(warned("F13", "win32"), []);
});

test("整份绑定：动作之间同键、用了取消的键、一个动作里写重复、超过 4 个、不能清空的清空了", () => {
  const reasons = (bindings, platform = "darwin") =>
    checkBindings(bindings, platform).map(
      ({ action, index, level, reason }) => `${action}#${index} ${level} ${en[platform].text(reason)}`,
    );
  const chords = (...texts) => texts.map(parseChord);

  assert.deepEqual(reasons({ dictate: chords("F13"), cancel: chords("F13") }), [
    "cancel#0 reject Already used by Voice input",
  ]);
  // 先到先得按传进来的先后：后来的让位。取消先占了 F13，语音输入的组合里就不能有它；反过来取消就不能用 F13
  assert.deepEqual(reasons({ cancel: chords("F13"), dictate: chords("ControlRight+F13") }), [
    "dictate#0 reject F13 is the key for Cancel: while you talk, pressing it only cancels",
  ]);
  assert.deepEqual(reasons({ dictate: chords("ControlRight+F13"), cancel: chords("F13") }), [
    "cancel#0 reject F13 is part of a Voice input combination: an action that works only while you talk can't use it",
  ]);
  assert.deepEqual(reasons({ cancel: chords("F13"), dictate: chords("F13") }), [
    "dictate#0 reject Already used by Cancel",
  ]);
  assert.deepEqual(reasons({ dictate: chords("AltRight", "AltRight"), cancel: chords("Escape") }), [
    "dictate#1 reject Listed twice",
  ]);
  assert.deepEqual(
    reasons({ dictate: chords("AltRight", "MetaRight", "ControlRight", "Fn", "F13"), cancel: chords("Escape") }),
    [
      "dictate#3 warn If the Globe key has another job in System Settings (switching input sources, emoji, dictation), that fires too; most external keyboards have no fn",
      "dictate#4 reject An action takes 4 combinations at most",
    ],
  );
  assert.deepEqual(reasons({ dictate: [], cancel: chords("Escape") }), [
    "dictate#0 reject Voice input needs at least one combination",
  ]);
  // 一个组合本身不行，也在这里报出来
  assert.deepEqual(reasons({ dictate: chords("MetaRight+KeyC"), cancel: chords("Escape") }), [
    "dictate#0 reject Command with a typing key is an app shortcut (copy, paste, save…)",
  ]);
  // 提醒：组合是另一个组合的一部分；单个组合自己的提醒也带上
  assert.deepEqual(reasons({ dictate: chords("AltRight", "AltRight+Space"), cancel: chords("Escape") }), [
    "dictate#0 warn It's part of Voice input's combination Right ⌥ Space: pressing that one fires this first",
    "dictate#1 warn Option with a typing key normally types a special character (Option-Space is a non-breaking space); bound, it no longer will",
  ]);
  assert.deepEqual(reasons({ dictate: chords("AltRight"), cancel: chords("Escape") }), []);
});

test("地球仪键那条提醒按系统设置说具体：设成无操作的不提醒，读不到的照原样说，别的提醒不动", () => {
  const fn = msg("binding.fnSystem");
  const wrapped = msg("hotkeySetting.problem", { chord: "fn", reason: fn });
  assert.equal(refineWarning(fn, { fnUsage: 0 }), null);
  assert.equal(refineWarning(wrapped, { fnUsage: 0 }), null);
  assert.deepEqual(refineWarning(fn, { fnUsage: 2 }), msg("binding.fnSystemUse", { use: msg("binding.fnUses.emoji") }));
  assert.deepEqual(
    refineWarning(wrapped, { fnUsage: 1 }),
    msg("hotkeySetting.problem", {
      chord: "fn",
      reason: msg("binding.fnSystemUse", { use: msg("binding.fnUses.inputSource") }),
    }),
  );
  assert.deepEqual(refineWarning(wrapped, { fnUsage: 3 }).params.reason.params.use, msg("binding.fnUses.dictation"));
  assert.equal(refineWarning(fn, {}), fn);
  assert.equal(refineWarning(fn, { fnUsage: 9 }), fn);
  const other = msg("binding.altGr");
  assert.equal(refineWarning(other, { fnUsage: 0 }), other);
});
