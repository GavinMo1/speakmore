import assert from "node:assert/strict";
import { test } from "node:test";
import { barHeight, controlsIn, hintFor, LINGER_MS, View, viewOf } from "../../src/renderer/bar-view.mjs";
import { Phase } from "../../src/renderer/machine.mjs";

const at = (phase, message = null) => ({ phase, held: false, message });

test("说话的三个阶段各有各的样子", () => {
  assert.equal(viewOf(at(Phase.STARTING), Phase.IDLE), View.STARTING);
  assert.equal(viewOf(at(Phase.RECORDING), Phase.STARTING), View.RECORDING);
  assert.equal(viewOf(at(Phase.FINISHING), Phase.RECORDING), View.FINISHING);
});

test("回到空闲：刚拿到成品就打个勾；取消了的直接消失；有话要说就显示那句话", () => {
  assert.equal(viewOf(at(Phase.IDLE), Phase.FINISHING), View.DONE);
  assert.equal(viewOf(at(Phase.IDLE), Phase.RECORDING), View.HIDDEN);
  assert.equal(viewOf(at(Phase.IDLE), Phase.STARTING), View.HIDDEN);
  assert.equal(viewOf(at(Phase.IDLE), Phase.IDLE), View.HIDDEN);
  assert.equal(viewOf(at(Phase.IDLE, "没有听到声音"), Phase.FINISHING), View.NOTICE);
  assert.equal(viewOf(at(Phase.IDLE, "还没有填 Gemini API key"), Phase.IDLE), View.NOTICE);
  assert.equal(viewOf(at(Phase.ERROR, "连不上 Gemini"), Phase.FINISHING), View.ERROR);
});

test("收尾的样子自己会消失，说话时的样子一直留着", () => {
  assert.equal(LINGER_MS[View.DONE] < LINGER_MS[View.NOTICE], true);
  assert.equal(LINGER_MS[View.NOTICE], LINGER_MS[View.ERROR]);
  for (const view of [View.STARTING, View.RECORDING, View.FINISHING, View.HIDDEN]) {
    assert.equal(LINGER_MS[view], undefined, view);
  }
});

test("上方的那行提示：告诉人现在在干什么、按哪个键；键名单独标出来", () => {
  const options = { keycap: "右⌥", cancellable: true };
  assert.deepEqual(hintFor(View.STARTING, options), ["正在打开麦克风"]);
  assert.deepEqual(hintFor(View.RECORDING, options), [
    "再按一下 ",
    { key: "右⌥" },
    " 完成 · ",
    { key: "esc" },
    " 取消",
  ]);
  assert.deepEqual(hintFor(View.FINISHING, options), ["整理中"]);
  for (const view of [View.DONE, View.NOTICE, View.ERROR, View.HIDDEN]) assert.deepEqual(hintFor(view, options), []);
});

test("取消不了的时候（没有辅助功能权限，截不住 esc）提示里不提 esc", () => {
  assert.deepEqual(hintFor(View.RECORDING, { keycap: "fn", cancellable: false }), [
    "再按一下 ",
    { key: "fn" },
    " 完成",
  ]);
});

test("哪个样子下哪个按钮点得动：打开麦克风时只能取消，正在听时取消和完成都行，别的时候都点不动", () => {
  assert.deepEqual(controlsIn(View.STARTING), ["cancel"]);
  assert.deepEqual(controlsIn(View.RECORDING), ["cancel", "confirm"]);
  for (const view of [View.FINISHING, View.DONE, View.NOTICE, View.ERROR, View.HIDDEN]) {
    assert.deepEqual(controlsIn(view), [], view);
  }
});

test("声波一根竖条的高度：按真实说话的音量标定，说话时竖条有四成到九成高，停顿时伏下去", () => {
  // 没声音、和 8 位波形分辨不出来的那一格以下：只留一点高度
  assert.equal(barHeight(0), 0.1);
  assert.equal(barHeight(1 / 128), 0.1);
  assert.equal(barHeight(-1), 0.1);
  // 再响也不超过满格
  assert.equal(barHeight(1), 1);
  assert.equal(barHeight(4), 1);
  // 下面三个音量是从真实录音里量出来的（每 50 ms 一个，共 707 个）：中位数、九成的时候不超过、最响
  assert.ok(barHeight(0.023) > 0.35 && barHeight(0.023) < 0.5, String(barHeight(0.023)));
  assert.ok(barHeight(0.094) > 0.75, String(barHeight(0.094)));
  assert.equal(barHeight(0.203), 1);
  // 越响越高
  const heights = [0.01, 0.02, 0.05, 0.1, 0.15].map(barHeight);
  assert.deepEqual(
    heights,
    [...heights].sort((a, b) => a - b),
  );
  assert.equal(new Set(heights).size, heights.length);
});
