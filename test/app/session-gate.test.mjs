import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionGate, gatedBindings, HOLD_MS } from "../../src/app/session-gate.mjs";
import { parseChord } from "../../src/hotkeys/chord.mjs";

const chords = (map) => Object.fromEntries(Object.entries(map).map(([id, list]) => [id, list.map(parseChord)]));
const DEFAULTS = chords({
  dictate: ["AltRight"],
  translate: ["AltRight+Space"],
  lookup: ["AltRight+Enter"],
  cancel: ["Escape"],
});

/** 假的计时器：手动拨 */
function fakeTimers() {
  let next = null;
  return {
    set(fn, ms) {
      next = { fn, ms };
      return next;
    },
    clear(handle) {
      if (next === handle) next = null;
    },
    get pending() {
      return next;
    },
    fire() {
      const due = next;
      next = null;
      due?.fn();
    },
  };
}

function gateWith(map = DEFAULTS) {
  const delivered = [];
  const timers = fakeTimers();
  const gate = createSessionGate({ deliver: (event) => delivered.push(event), timers });
  gate.setChords(map);
  return { gate, delivered, timers };
}

const down = (id) => ({ event: "binding", id, down: true });
const up = (id) => ({ event: "binding", id, down: false });
const interrupted = (id, to) => ({ event: "interrupted", id, ...(to ? { to } : {}) });

test("要压住的：录音会话的组合是别的（不是录音会话、任何时候都算的）动作某个组合的一部分", () => {
  assert.deepEqual([...gatedBindings(DEFAULTS)], ["dictate#0"]);
  // 语音翻译的组合不是谁的一部分；语音输入是语音翻译的一部分，但那是升级，不用压
  assert.deepEqual(
    [...gatedBindings(chords({ dictate: ["AltRight"], translate: ["AltRight+Space"], lookup: [] }))],
    [],
  );
  // 第二个组合才是划词的一部分
  assert.deepEqual(
    [
      ...gatedBindings(
        chords({ dictate: ["F13", "ControlRight"], lookup: ["ControlRight+Enter"], cancel: ["Escape"] }),
      ),
    ],
    ["dictate#1"],
  );
  // 一样长的不算一部分（同键本来就不让绑）；划词的键是语音输入的一部分时不压语音输入
  assert.deepEqual([...gatedBindings(chords({ dictate: ["AltRight+Enter"], lookup: ["F13"] }))], []);
});

test("点按语音输入：按下先压住，松开时连着按下一起交出去", () => {
  const { gate, delivered, timers } = gateWith();
  gate.accept(down("dictate#0"));
  assert.deepEqual(delivered, []);
  assert.equal(timers.pending.ms, HOLD_MS);
  gate.accept(up("dictate#0"));
  assert.deepEqual(delivered, [down("dictate#0"), up("dictate#0")]);
  assert.equal(timers.pending, null);
});

test("按着不放：到点交出按下，之后的松开照常过", () => {
  const { gate, delivered, timers } = gateWith();
  gate.accept(down("dictate#0"));
  timers.fire();
  assert.deepEqual(delivered, [down("dictate#0")]);
  gate.accept(up("dictate#0"));
  assert.deepEqual(delivered, [down("dictate#0"), up("dictate#0")]);
});

test("凑成了划词：压住的按下和这次打断都丢掉，划词自己的按下照常过", () => {
  const { gate, delivered, timers } = gateWith();
  gate.accept(down("dictate#0"));
  gate.accept(interrupted("dictate#0", "lookup#0"));
  gate.accept(down("lookup#0"));
  gate.accept(up("lookup#0"));
  assert.deepEqual(delivered, [down("lookup#0"), up("lookup#0")]);
  assert.equal(timers.pending, null);
});

test("凑成语音翻译、或者是别的组合键（⌥E 打字）：一样整个丢掉，悬浮条不闪", () => {
  const { gate, delivered } = gateWith();
  gate.accept(down("dictate#0"));
  gate.accept(interrupted("dictate#0", "translate#0"));
  gate.accept(down("translate#0"));
  assert.deepEqual(delivered, [down("translate#0")]);
  delivered.length = 0;
  gate.accept(down("dictate#0"));
  gate.accept(interrupted("dictate#0"));
  assert.deepEqual(delivered, []);
});

test("到点交出去以后才被打断：打断照常过（悬浮条按升级或作废处理）", () => {
  const { gate, delivered, timers } = gateWith();
  gate.accept(down("dictate#0"));
  timers.fire();
  gate.accept(interrupted("dictate#0", "lookup#0"));
  assert.deepEqual(delivered, [down("dictate#0"), interrupted("dictate#0", "lookup#0")]);
});

test("不用压的绑定原样过；没绑划词时语音输入也不压", () => {
  const { gate, delivered } = gateWith();
  for (const event of [down("translate#0"), up("translate#0"), down("cancel#0"), down("lookup#0")]) gate.accept(event);
  assert.deepEqual(delivered, [down("translate#0"), up("translate#0"), down("cancel#0"), down("lookup#0")]);
  const plain = gateWith(
    chords({ dictate: ["AltRight"], translate: ["AltRight+Space"], lookup: [], cancel: ["Escape"] }),
  );
  plain.gate.accept(down("dictate#0"));
  assert.deepEqual(plain.delivered, [down("dictate#0")]);
});

test("压着的时候按了截着的取消键：取消照常交出去，压着的那一下作废，松开时不再开始一段新的", () => {
  const { gate, delivered, timers } = gateWith();
  gate.accept(down("dictate#0"));
  gate.accept(down("cancel#0"));
  assert.equal(timers.pending, null);
  gate.accept(up("cancel#0"));
  gate.accept(up("dictate#0"));
  assert.deepEqual(delivered, [down("cancel#0"), up("cancel#0"), up("dictate#0")]);
});

test("换热键、换小帮手：压着的那一下丢掉，计时器收掉", () => {
  const { gate, delivered, timers } = gateWith();
  gate.accept(down("dictate#0"));
  gate.reset();
  assert.equal(timers.pending, null);
  gate.accept(up("dictate#0"));
  assert.deepEqual(delivered, [up("dictate#0")]);
  // 换成不压的热键：压着的也丢掉
  gate.accept(down("dictate#0"));
  gate.setChords(chords({ dictate: ["AltRight"], lookup: [] }));
  assert.equal(timers.pending, null);
  gate.accept(down("dictate#0"));
  assert.deepEqual(delivered, [up("dictate#0"), down("dictate#0")]);
});
