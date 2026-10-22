// 键表：全项目认哪些键、每个键在两个系统上的原生码，只有这一张。
// 设置、文案、日志里一律写 W3C KeyboardEvent.code 名（AltRight、Space、F13，https://www.w3.org/TR/uievents-code/ ）：
// 它只说键在键盘上的位置，换布局不变。主进程把 code 换成原生码下发给小帮手，小帮手不认键名（docs/hotkey-research.md 5.1）。
//
// 原生码抄自 Chromium 的 ui/events/keycodes/dom/dom_code_data.inc（2026-10-20 的 main，文件 sha256 前缀 841e2c58e638，
// 第 112–446 行里的这几行），只取了这里用到的；fn 在 Mac 上的码那里写的是"不映射"，按 SDK 的 kVK_Function 补上。
//   Copyright 2013 The Chromium Authors
//   许可是 BSD 三条款，原文附在文件末尾。
//
// 每行：
//   kind   modifier 修饰键；function 能单独当快捷键的（F 键、菜单键）；typing 打字的键，要和修饰键一起按；
//          escape 只给"只在说话时生效"的动作单独用；blocked 认得但一律不让绑（打字和挪光标要用的、带开关状态的、截屏）
//   mac    kVK 键码（HIToolbox/Events.h）；这个系统上没有这个键时是 null
//   win    扫描码，带 0xE0 前缀的扩展键把前缀放在高字节；没有时是 null
//   vk     Windows 的虚拟键码，只有修饰键有：Windows 小帮手按 vk 认修饰键、按扫描码认别的键（4.2）
//   label  键帽上的字和语言无关的键（字母、数字、F 键、标点）写在这里；别的键的名字和键帽在文案里（keys.<code>）

const row = (code, kind, mac, win, extra = {}) => Object.freeze({ code, kind, mac, win, ...extra });
const letters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const MAC_LETTERS = [
  0x00, 0x0b, 0x08, 0x02, 0x0e, 0x03, 0x05, 0x04, 0x22, 0x26, 0x28, 0x25, 0x2e, 0x2d, 0x1f, 0x23, 0x0c, 0x0f, 0x01,
  0x11, 0x20, 0x09, 0x0d, 0x07, 0x10, 0x06,
];
const WIN_LETTERS = [
  0x1e, 0x30, 0x2e, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17, 0x24, 0x25, 0x26, 0x32, 0x31, 0x18, 0x19, 0x10, 0x13, 0x1f,
  0x14, 0x16, 0x2f, 0x11, 0x2d, 0x15, 0x2c,
];
const MAC_DIGITS = [0x1d, 0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1a, 0x1c, 0x19];
const WIN_DIGITS = [0x0b, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a];
const MAC_F = [
  0x7a,
  0x78,
  0x63,
  0x76,
  0x60,
  0x61,
  0x62,
  0x64,
  0x65,
  0x6d,
  0x67,
  0x6f,
  0x69,
  0x6b,
  0x71,
  0x6a,
  0x40,
  0x4f,
  0x50,
  0x5a,
  null,
  null,
  null,
  null,
];
const WIN_F = [
  0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x44, 0x57, 0x58, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a,
  0x6b, 0x6c, 0x6d, 0x6e, 0x76,
];

export const KEYS = Object.freeze([
  row("ControlLeft", "modifier", 0x3b, 0x001d, { vk: 0xa2 }),
  row("ControlRight", "modifier", 0x3e, 0xe01d, { vk: 0xa3 }),
  row("ShiftLeft", "modifier", 0x38, 0x002a, { vk: 0xa0 }),
  row("ShiftRight", "modifier", 0x3c, 0x0036, { vk: 0xa1 }),
  row("AltLeft", "modifier", 0x3a, 0x0038, { vk: 0xa4 }),
  row("AltRight", "modifier", 0x3d, 0xe038, { vk: 0xa5 }),
  row("MetaLeft", "modifier", 0x37, 0xe05b, { vk: 0x5b }),
  row("MetaRight", "modifier", 0x36, 0xe05c, { vk: 0x5c }),
  // Windows 上系统看不到 fn（多半由键盘固件自己处理）
  row("Fn", "modifier", 0x3f, null),

  ...WIN_F.map((win, i) => row(`F${i + 1}`, "function", MAC_F[i], win, { label: `F${i + 1}` })),
  row("ContextMenu", "function", 0x6e, 0xe05d),

  row("Space", "typing", 0x31, 0x0039),
  ...letters.map((letter, i) => row(`Key${letter}`, "typing", MAC_LETTERS[i], WIN_LETTERS[i], { label: letter })),
  ...WIN_DIGITS.map((win, i) => row(`Digit${i}`, "typing", MAC_DIGITS[i], win, { label: `${i}` })),
  row("Minus", "typing", 0x1b, 0x000c, { label: "-" }),
  row("Equal", "typing", 0x18, 0x000d, { label: "=" }),
  row("BracketLeft", "typing", 0x21, 0x001a, { label: "[" }),
  row("BracketRight", "typing", 0x1e, 0x001b, { label: "]" }),
  row("Backslash", "typing", 0x2a, 0x002b, { label: "\\" }),
  row("Semicolon", "typing", 0x29, 0x0027, { label: ";" }),
  row("Quote", "typing", 0x27, 0x0028, { label: "'" }),
  row("Backquote", "typing", 0x32, 0x0029, { label: "`" }),
  row("Comma", "typing", 0x2b, 0x0033, { label: "," }),
  row("Period", "typing", 0x2f, 0x0034, { label: "." }),
  row("Slash", "typing", 0x2c, 0x0035, { label: "/" }),

  row("Escape", "escape", 0x35, 0x0001),

  // 打字、挪光标要用的：和 Ctrl、⌘、Alt 组合几乎全是系统或编辑器的快捷键（⌥← 跳词、Ctrl+Enter 发送、Alt+Tab 切窗口）
  row("Enter", "blocked", 0x24, 0x001c),
  row("Tab", "blocked", 0x30, 0x000f),
  row("Backspace", "blocked", 0x33, 0x000e),
  row("Delete", "blocked", 0x75, 0xe053),
  row("Insert", "blocked", 0x72, 0xe052),
  row("Home", "blocked", 0x73, 0xe047),
  row("End", "blocked", 0x77, 0xe04f),
  row("PageUp", "blocked", 0x74, 0xe049),
  row("PageDown", "blocked", 0x79, 0xe051),
  row("ArrowUp", "blocked", 0x7e, 0xe048),
  row("ArrowDown", "blocked", 0x7d, 0xe050),
  row("ArrowLeft", "blocked", 0x7b, 0xe04b),
  row("ArrowRight", "blocked", 0x7c, 0xe04d),
  // 带开关状态的：按一下就改了大小写、数字小键盘（CapsLock 的标志位反映的是"锁没锁"，不是"按没按"）
  row("CapsLock", "blocked", 0x39, 0x003a),
  row("NumLock", "blocked", 0x47, 0xe045),
  row("ScrollLock", "blocked", null, 0x0046),
  // 系统自己用的：截屏
  row("Pause", "blocked", null, 0x0045),
  row("PrintScreen", "blocked", null, 0xe037),
]);

const BY_CODE = new Map(KEYS.map((key) => [key.code, key]));

/** 这个 code 的那一行；不认识的是 null */
export const keyOf = (code) => BY_CODE.get(code) ?? null;

export const isModifier = (code) => keyOf(code)?.kind === "modifier";

export const SHIFTS = Object.freeze(["ShiftLeft", "ShiftRight"]);

/**
 * 组合里修饰键的先后，两个系统一样：fn 在最前，其余是 Control、Option（Alt）、Shift、Command（Win），
 * 和 Apple、微软的写法都一致（5.7）。存下来的、显示的都按这个排，和按下的先后无关
 */
export const MODIFIER_ORDER = Object.freeze([
  "Fn",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

/** 这个系统的键盘上有没有这个键 */
export function availableOn(code, platform) {
  const key = keyOf(code);
  if (key === null) return false;
  return (platform === "win32" ? key.win : key.mac) !== null;
}

/**
 * 下发给小帮手的原生码：Mac 是 kVK；Windows 上修饰键是 vk，别的键是扫描码。这个系统上没有这个键时是 null
 * @param {string} code
 * @param {"darwin" | "win32"} platform
 */
export function nativeCode(code, platform) {
  const key = keyOf(code);
  if (key === null) return null;
  if (platform !== "win32") return key.mac;
  return key.kind === "modifier" ? (key.vk ?? null) : key.win;
}

const byNative = (platform, modifier) =>
  new Map(
    KEYS.filter((key) => (key.kind === "modifier") === modifier)
      .map((key) => [nativeCode(key.code, platform), key.code])
      .filter(([native]) => native !== null),
  );
const NATIVE = {
  darwin: { modifier: byNative("darwin", true), other: byNative("darwin", false) },
  win32: { modifier: byNative("win32", true), other: byNative("win32", false) },
};

/**
 * 小帮手录键时报的原生码 → code。修饰键和别的键分开报（Windows 上两者是不同的码），表里没有的是 null
 * @param {number} native
 * @param {{ platform: "darwin" | "win32", modifier: boolean }} options
 */
export function codeOfNative(native, { platform, modifier }) {
  const table = NATIVE[platform === "win32" ? "win32" : "darwin"];
  return (modifier ? table.modifier : table.other).get(native) ?? null;
}

// Chromium 的许可原文（dom_code_data.inc 的头注释指向它）：
//
// Copyright 2015 The Chromium Authors
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//    * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//    * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//    * Neither the name of Google LLC nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
