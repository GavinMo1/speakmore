import assert from "node:assert/strict";
import { test } from "node:test";
import { createRecordRound } from "../../src/hotkeys/record.mjs";

// 录键的定稿规则（docs/hotkey-research.md 5.6）：小帮手报按住的原生码，键数第一次变少时定稿，定成此前按住最多的那一组

const MAC = { platform: "darwin", cancelable: true };
const RIGHT_OPTION = 0x3d;
const RIGHT_COMMAND = 0x36;
const SPACE = 0x31;
const FN = 0x3f;
const F5 = 0x60;
const ESCAPE = 0x35;

/** 依次喂几份快照，收集每一步的结果（没定稿的是 null） */
function feedAll(round, snapshots) {
  return snapshots.map((snapshot) => round.feed(snapshot).result);
}

test("修饰键 + 普通键：普通键先松开时定稿，定成两个键", () => {
  const round = createRecordRound(MAC);
  const results = feedAll(round, [
    { mods: [], keys: [] },
    { mods: [RIGHT_OPTION], keys: [] },
    { mods: [RIGHT_OPTION], keys: [SPACE] },
    { mods: [RIGHT_OPTION], keys: [] },
    { mods: [], keys: [] },
  ]);
  assert.deepEqual(results, [null, null, null, { codes: ["AltRight", "Space"] }, null]);
});

test("修饰键先松开也一样：定成此前最多的那一组", () => {
  const round = createRecordRound(MAC);
  const results = feedAll(round, [
    { mods: [RIGHT_OPTION] },
    { mods: [RIGHT_OPTION], keys: [SPACE] },
    { keys: [SPACE] },
    {},
  ]);
  assert.deepEqual(results, [null, null, { codes: ["AltRight", "Space"] }, null]);
});

test("单个修饰键：松开时定稿", () => {
  const round = createRecordRound(MAC);
  assert.deepEqual(feedAll(round, [{ mods: [RIGHT_COMMAND] }, {}]), [null, { codes: ["MetaRight"] }]);
});

test("定过一次以后，全部松开之前再按什么都不算；全松开后是新的一轮", () => {
  const round = createRecordRound(MAC);
  const results = feedAll(round, [
    { mods: [RIGHT_OPTION] },
    { mods: [RIGHT_OPTION], keys: [SPACE] },
    { mods: [RIGHT_OPTION] },
    { mods: [RIGHT_OPTION], keys: [SPACE] },
    { mods: [RIGHT_OPTION] },
    {},
    { mods: [RIGHT_COMMAND] },
    {},
  ]);
  assert.deepEqual(results, [
    null,
    null,
    { codes: ["AltRight", "Space"] },
    null,
    null,
    null,
    null,
    { codes: ["MetaRight"] },
  ]);
});

test("按到第三个键当场提示；定稿时照样交出三个键，由保存时的校验说最多两个", () => {
  const round = createRecordRound(MAC);
  round.feed({ mods: [RIGHT_OPTION] });
  round.feed({ mods: [RIGHT_OPTION], keys: [SPACE] });
  const three = round.feed({ mods: [RIGHT_OPTION, RIGHT_COMMAND], keys: [SPACE] });
  assert.equal(three.tooMany, true);
  assert.equal(three.result, null);
  const done = round.feed({ mods: [RIGHT_OPTION], keys: [SPACE] });
  assert.equal(done.tooMany, false);
  assert.deepEqual(done.result, { codes: ["AltRight", "MetaRight", "Space"] });
});

test("实时显示：按着的键按显示顺序给出，认不出的另外标出来", () => {
  const round = createRecordRound(MAC);
  assert.deepEqual(round.feed({ mods: [RIGHT_OPTION], keys: [SPACE] }), {
    codes: ["AltRight", "Space"],
    unknown: false,
    tooMany: false,
    result: null,
  });
  const strange = round.feed({ mods: [RIGHT_OPTION], keys: [SPACE, 0x7f] });
  assert.equal(strange.unknown, true);
  assert.deepEqual(strange.codes, ["AltRight", "Space"]);
});

test("有认不出的键：定稿成一个错误，不存", () => {
  const round = createRecordRound(MAC);
  const results = feedAll(round, [{ keys: [0x7f] }, {}]);
  assert.equal(results[0], null);
  assert.equal(results[1].error.key, "hotkeyRecord.unknownKey");
});

test("单按 esc 是取消录键；录只在说话时生效的动作（取消）时 esc 就是录到的键", () => {
  assert.deepEqual(feedAll(createRecordRound(MAC), [{ keys: [ESCAPE] }, {}]), [null, { cancel: true }]);
  assert.deepEqual(feedAll(createRecordRound({ ...MAC, cancelable: false }), [{ keys: [ESCAPE] }, {}]), [
    null,
    { codes: ["Escape"] },
  ]);
});

test("Mac：fn 按着按 F 键就是那个 F 键（MacBook 第一排要按着 fn 才是 F 键）；fn 加别的键照留", () => {
  assert.deepEqual(feedAll(createRecordRound(MAC), [{ mods: [FN] }, { mods: [FN], keys: [F5] }, { mods: [FN] }]), [
    null,
    null,
    { codes: ["F5"] },
  ]);
  assert.deepEqual(feedAll(createRecordRound(MAC), [{ mods: [FN] }, { mods: [FN], keys: [SPACE] }, { mods: [FN] }]), [
    null,
    null,
    { codes: ["Fn", "Space"] },
  ]);
});

test("Windows：修饰键报的是 vk，别的键报扫描码", () => {
  const round = createRecordRound({ platform: "win32", cancelable: true });
  const results = feedAll(round, [{ mods: [0xa3] }, { mods: [0xa3], keys: [0x64] }, { mods: [0xa3] }]);
  assert.deepEqual(results, [null, null, { codes: ["ControlRight", "F13"] }]);
});

test("一个键都没按就是空的，不定稿", () => {
  const round = createRecordRound(MAC);
  assert.deepEqual(feedAll(round, [{}, { mods: [], keys: [] }]), [null, null]);
});
