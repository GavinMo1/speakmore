import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIONS, actionOf } from "../../src/hotkeys/actions.mjs";
import { actionOfBinding, bindingTable } from "../../src/hotkeys/bindings.mjs";
import { parseChord } from "../../src/hotkeys/chord.mjs";

const chords = (map) => Object.fromEntries(Object.entries(map).map(([id, list]) => [id, list.map(parseChord)]));

test("下发的绑定表：Mac 发 kVK；修饰键和普通键分两栏，没有普通键就不带 key", () => {
  const table = bindingTable(chords({ dictate: ["AltRight", "AltRight+Space", "F13"], cancel: ["Escape"] }), "darwin");
  assert.deepEqual(table, [
    { id: "dictate#0", mods: [0x3d], when: "always" },
    { id: "dictate#1", mods: [0x3d], key: 0x31, when: "always" },
    { id: "dictate#2", mods: [], key: 0x69, when: "always" },
    { id: "cancel#0", mods: [], key: 0x35, when: "capturing" },
  ]);
});

test("下发的绑定表：Windows 上修饰键发 vk，别的键发扫描码，扩展键的 0xE0 前缀在高字节", () => {
  const table = bindingTable(
    chords({ dictate: ["ControlRight", "ContextMenu", "ShiftRight+F13"], cancel: ["Escape"] }),
    "win32",
  );
  assert.deepEqual(table, [
    { id: "dictate#0", mods: [0xa3], when: "always" },
    { id: "dictate#1", mods: [], key: 0xe05d, when: "always" },
    { id: "dictate#2", mods: [0xa1], key: 0x64, when: "always" },
    { id: "cancel#0", mods: [], key: 0x01, when: "capturing" },
  ]);
});

test("两个修饰键的组合：mods 按显示的先后排，和写的先后无关", () => {
  const [row] = bindingTable(chords({ dictate: ["ShiftRight+ControlRight"] }), "darwin");
  assert.deepEqual(row.mods, [0x3e, 0x3c]);
});

test("按动作目录的先后出表；目录里有、这里没写的动作不出；不认识的动作不出", () => {
  const table = bindingTable({ cancel: [["Escape"]], dictate: [["AltRight"]], nope: [["F13"]] }, "darwin");
  assert.deepEqual(
    table.map((row) => row.id),
    ["dictate#0", "cancel#0"],
  );
  assert.deepEqual(bindingTable({ dictate: [] }, "darwin"), []);
});

test("这个系统上没有的键：不是静默跳过，是报错（校验该在前面拦下）", () => {
  assert.throws(() => bindingTable(chords({ dictate: ["Fn"] }), "win32"), /Fn/);
});

test("绑定 id 认回动作：每个动作的每个组合都认得回来；不认识的是 null", () => {
  const all = Object.fromEntries(ACTIONS.map((action) => [action.id, [["F13"], ["F14"]]]));
  for (const row of bindingTable(all, "darwin")) {
    assert.equal(actionOfBinding(row.id), actionOf(row.id.split("#")[0]), row.id);
  }
  for (const id of ["", "nope#0", "dictate", "#0", undefined, 7]) assert.equal(actionOfBinding(id), null, String(id));
});
