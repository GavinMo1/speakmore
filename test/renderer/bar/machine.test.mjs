import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIONS, actionOf } from "../../../src/hotkeys/actions.mjs";
import { createTranslator } from "../../../src/i18n/index.mjs";
import {
  Action,
  eventTypeOf,
  initialState,
  LONG_PRESS_MS,
  Phase,
  transition,
} from "../../../src/renderer/bar/machine.mjs";

const zh = createTranslator("zh-CN");

/** 依次喂事件，返回最后的状态和每一步的动作 */
function run(...events) {
  let state = initialState;
  const steps = [];
  for (const event of events) {
    const result = transition(state, typeof event === "string" ? { type: event } : event);
    state = result.state;
    steps.push(result.actions);
  }
  return { state, steps };
}

test("单击开始，再单击结束，收到成品回到空闲", () => {
  const { state, steps } = run("KEY_DOWN", "MIC_READY", "KEY_UP", "KEY_DOWN", "KEY_UP", "RESULT");
  assert.deepEqual(steps, [
    [Action.START, Action.ARM_HOLD_TIMER],
    [],
    [Action.CLEAR_HOLD_TIMER],
    [Action.STOP],
    [],
    [],
  ]);
  assert.deepEqual(state, initialState);
});

test("松开比麦克风就绪早，也照常进入录音", () => {
  const { state } = run("KEY_DOWN", "KEY_UP", "MIC_READY");
  assert.deepEqual(state, { ...initialState, phase: Phase.RECORDING });
});

test("按住超过时限：取消，并告诉用户不支持按住说话", () => {
  const { state, steps } = run("KEY_DOWN", "MIC_READY", "LONG_HOLD");
  assert.equal(state.phase, Phase.IDLE);
  assert.match(zh.text(state.message), /不支持按住说话/);
  assert.deepEqual(steps.at(-1), [Action.CANCEL]);
  // 取消之后才松手，不能再触发任何事
  assert.deepEqual(transition(state, { type: "KEY_UP" }), { state, actions: [] });
});

test("已经松开之后，迟到的长按定时器不起作用", () => {
  const { state, steps } = run("KEY_DOWN", "MIC_READY", "KEY_UP", "LONG_HOLD");
  assert.equal(state.phase, Phase.RECORDING);
  assert.deepEqual(steps.at(-1), []);
});

test("热键加别的键是组合键：悄悄取消，不提示", () => {
  const { state, steps } = run("KEY_DOWN", "OTHER_KEY");
  assert.deepEqual(state, initialState);
  assert.deepEqual(steps.at(-1), [Action.CANCEL, Action.CLEAR_HOLD_TIMER]);
});

test("录音中正常打字不影响录音", () => {
  const { state, steps } = run("KEY_DOWN", "MIC_READY", "KEY_UP", "OTHER_KEY");
  assert.equal(state.phase, Phase.RECORDING);
  assert.deepEqual(steps.at(-1), []);
});

test("松开的事件丢了，再按一下照样能结束；迟到的长按定时器不会把它取消", () => {
  const { state, steps } = run("KEY_DOWN", "MIC_READY", "KEY_DOWN", "LONG_HOLD");
  assert.equal(state.phase, Phase.FINISHING);
  assert.deepEqual(steps.slice(-2), [[Action.STOP], []]);
});

test("麦克风没就绪就按了第二下：作罢", () => {
  const { state, steps } = run("KEY_DOWN", "KEY_UP", "KEY_DOWN");
  assert.deepEqual(state, initialState);
  assert.deepEqual(steps.at(-1), [Action.CANCEL]);
});

test("等成品时再按热键不会开始新的一次", () => {
  const { state, steps } = run("KEY_DOWN", "MIC_READY", "KEY_UP", "KEY_DOWN", "KEY_UP", "KEY_DOWN");
  assert.equal(state.phase, Phase.FINISHING);
  assert.deepEqual(steps.at(-1), []);
});

test("录音到上限自动结束", () => {
  const { state, steps } = run("KEY_DOWN", "MIC_READY", "KEY_UP", "MAX_DURATION");
  assert.equal(state.phase, Phase.FINISHING);
  assert.deepEqual(steps.at(-1), [Action.STOP]);
});

test("成品可以带一句提示回到空闲", () => {
  const { state } = run("KEY_DOWN", "MIC_READY", "KEY_UP", "KEY_DOWN", { type: "RESULT", message: "没有听到声音" });
  assert.deepEqual(state, { ...initialState, message: "没有听到声音" });
});

test("出错：录音阶段要收掉麦克风，等成品阶段不用；之后按热键能重新开始", () => {
  const starting = run("KEY_DOWN", { type: "FAILED", message: "麦克风打不开" });
  assert.deepEqual(starting.state, { ...initialState, phase: Phase.ERROR, message: "麦克风打不开" });
  assert.deepEqual(starting.steps.at(-1), [Action.CANCEL, Action.CLEAR_HOLD_TIMER]);

  const finishing = run("KEY_DOWN", "MIC_READY", "KEY_UP", "KEY_DOWN", { type: "FAILED", message: "服务端没有回应" });
  assert.equal(finishing.state.phase, Phase.ERROR);
  assert.deepEqual(finishing.steps.at(-1), []);

  const retry = transition(finishing.state, { type: "KEY_DOWN" });
  assert.equal(retry.state.phase, Phase.STARTING);
  assert.equal(retry.state.message, null);
});

test("录音中取消（点 ✕ 或按 esc）：丢掉这次录音回到空闲，不提示；麦克风还没就绪时也能取消", () => {
  const recording = run("KEY_DOWN", "MIC_READY", "KEY_UP", "USER_CANCEL");
  assert.deepEqual(recording.state, initialState);
  assert.deepEqual(recording.steps.at(-1), [Action.CANCEL, Action.CLEAR_HOLD_TIMER]);

  const starting = run("KEY_DOWN", "USER_CANCEL");
  assert.deepEqual(starting.state, initialState);
  assert.deepEqual(starting.steps.at(-1), [Action.CANCEL, Action.CLEAR_HOLD_TIMER]);
  // 取消之后才松开热键，不能再触发任何事
  assert.deepEqual(transition(starting.state, { type: "KEY_UP" }), { state: starting.state, actions: [] });
});

test("取消只在说话的时候管用：等成品时取消不了，空闲和出错之后按了也没事", () => {
  const finishing = run("KEY_DOWN", "MIC_READY", "KEY_UP", "KEY_DOWN", "USER_CANCEL");
  assert.equal(finishing.state.phase, Phase.FINISHING);
  assert.deepEqual(finishing.steps.at(-1), []);
  assert.deepEqual(run("USER_CANCEL").state, initialState);
  const failed = run("KEY_DOWN", { type: "FAILED", message: "麦克风打不开" }, "USER_CANCEL");
  assert.equal(failed.state.phase, Phase.ERROR);
  assert.deepEqual(failed.steps.at(-1), []);
});

test("点完成等于再按一下热键：结束录音、要成品；麦克风没就绪或已经在等成品时点了不算", () => {
  const { state, steps } = run("KEY_DOWN", "MIC_READY", "KEY_UP", "USER_CONFIRM");
  assert.deepEqual(state, { ...initialState, phase: Phase.FINISHING });
  assert.deepEqual(steps.at(-1), [Action.STOP]);

  const starting = run("KEY_DOWN", "KEY_UP", "USER_CONFIRM");
  assert.equal(starting.state.phase, Phase.STARTING);
  assert.deepEqual(starting.steps.at(-1), []);
  const twice = run("KEY_DOWN", "MIC_READY", "KEY_UP", "USER_CONFIRM", "USER_CONFIRM");
  assert.equal(twice.state.phase, Phase.FINISHING);
  assert.deepEqual(twice.steps.at(-1), []);
  assert.deepEqual(run("USER_CONFIRM").state, initialState);
});

test("空闲时来的成品和报错都忽略；不认识的事件直接报错", () => {
  assert.deepEqual(run("RESULT").state, initialState);
  assert.deepEqual(run({ type: "FAILED", message: "x" }).state, initialState);
  assert.throws(() => transition(initialState, { type: "NOPE" }), /不认识的事件/);
});

test("小帮手报的事 → 状态机的事件：语音输入的按下、松开、被打断，取消只看按下", () => {
  const cases = [
    [{ event: "binding", action: "dictate", down: true }, "KEY_DOWN"],
    [{ event: "binding", action: "dictate", down: false }, "KEY_UP"],
    // 升级（带 to）也是被打断：这一次作废，新绑定的按下紧跟着另报
    [{ event: "interrupted", action: "dictate" }, "OTHER_KEY"],
    [{ event: "interrupted", action: "dictate", to: "x#0" }, "OTHER_KEY"],
    // 升级到另一个录音会话（语音翻译）：这一次换成它，录音不断；升级到别的动作照样作废
    [{ event: "interrupted", action: "dictate", to: "translate" }, "SWITCH"],
    [{ event: "interrupted", action: "dictate", to: "cancel" }, "OTHER_KEY"],
    [{ event: "binding", action: "cancel", down: true }, "USER_CANCEL"],
    [{ event: "binding", action: "cancel", down: false }, null],
    [{ event: "click", id: "cancel" }, "USER_CANCEL"],
    [{ event: "click", id: "confirm" }, "USER_CONFIRM"],
  ];
  for (const [input, type] of cases) assert.equal(eventTypeOf(input), type, JSON.stringify(input));
});

test("认不出来的输入是 undefined（页面记一条警告），不是 null，也不会让状态机抛错", () => {
  for (const input of [
    { event: "binding", action: "nope", down: true },
    { event: "binding", down: true },
    { event: "click", id: "constructor" },
    { event: "click", id: "nope" },
    { event: "hotkey", down: true },
    { event: "escape" },
    null,
  ]) {
    assert.equal(eventTypeOf(input), undefined, JSON.stringify(input));
  }
});

test("动作目录里每个动作的处理者，悬浮条都认得它的按下", () => {
  for (const action of ACTIONS) {
    assert.notEqual(eventTypeOf({ event: "binding", action: action.id, down: true }), undefined, action.id);
  }
});

test("按住多久算按住：取自动作目录里语音输入的 longPressMs", () => {
  assert.equal(LONG_PRESS_MS, actionOf("dictate").longPressMs);
  assert.equal(LONG_PRESS_MS, 600);
});

// ---------- 几个录音会话的动作：语音输入、语音翻译 ----------

const press = (action, down = true) => ({ type: down ? "KEY_DOWN" : "KEY_UP", action });

test("记着这一次是哪个动作：按语音翻译开始的就是语音翻译，到出成品都是它；回到空闲就忘掉", () => {
  const { state, steps } = run(press("translate"), "MIC_READY", press("translate", false));
  assert.equal(state.action, "translate");
  assert.deepEqual(steps[0], [Action.START, Action.ARM_HOLD_TIMER]);
  const finishing = transition(state, press("translate")).state;
  assert.deepEqual([finishing.phase, finishing.action], [Phase.FINISHING, "translate"]);
  assert.equal(transition(finishing, { type: "RESULT" }).state.action, null);
});

test("说着话按另一个动作的键也算再按一下：语音翻译说到一半按右⌥，照样结束，出的还是翻译", () => {
  const { state, steps } = run(press("translate"), "MIC_READY", press("translate", false), press("dictate"));
  assert.deepEqual([state.phase, state.action], [Phase.FINISHING, "translate"]);
  assert.deepEqual(steps.at(-1), [Action.STOP]);
});

test("升级：按着右⌥又按了空格，这一次换成语音翻译、录音不断；紧跟着的那个按下不算再按一下", () => {
  for (const ready of [[], ["MIC_READY"]]) {
    // 麦克风就绪前后升级都一样：空格往往在麦克风就绪之后才到
    const { state, steps } = run(
      press("dictate"),
      ...ready,
      { type: "SWITCH", to: "translate" },
      press("translate"),
      press("translate", false),
    );
    assert.equal(state.action, "translate");
    assert.equal(state.phase, ready.length ? Phase.RECORDING : Phase.STARTING);
    assert.equal(state.switched, false);
    assert.deepEqual(steps.slice(-3), [[Action.SWITCH], [], [Action.CLEAR_HOLD_TIMER]]);
    // 之后再按一下才是结束
    const stop = transition({ ...state, phase: Phase.RECORDING }, press("translate"));
    assert.deepEqual(stop.actions, [Action.STOP]);
  }
});

test("升级后按满时限照样作废；没在说话时来的升级不管，紧跟着的按下照常开始", () => {
  const held = run(press("dictate"), { type: "SWITCH", to: "translate" }, press("translate"), "LONG_HOLD");
  assert.deepEqual([held.state.phase, held.steps.at(-1)], [Phase.IDLE, [Action.CANCEL]]);
  // 语音输入被主进程拦下没开始（悬浮条一直空闲），升级来了也不管；语音翻译的按下照常开始
  const idle = run({ type: "SWITCH", to: "translate" }, press("translate"));
  assert.deepEqual(idle.steps, [[], [Action.START, Action.ARM_HOLD_TIMER]]);
  assert.equal(idle.state.action, "translate");
  // 已经松开了的（不是按着凑出来的）不算升级
  const released = run(press("dictate"), "MIC_READY", press("dictate", false), { type: "SWITCH", to: "translate" });
  assert.equal(released.state.action, "dictate");
  assert.deepEqual(released.steps.at(-1), []);
});
