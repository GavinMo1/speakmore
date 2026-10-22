import assert from "node:assert/strict";
import { test } from "node:test";
import { actionOf } from "../../../src/hotkeys/actions.mjs";
import { findTask, TASKS, taskOfMode } from "../../../src/server/tasks/index.mjs";

// 任务表的约定（src/server/tasks/index.mjs 文件头）：按表逐个任务查，加任务时漏了哪一处会红

/** 每一步的那一副要有的东西 */
const FACES = {
  native: { system: "function", reminder: "string", finish: "function" },
  polish: { system: "function", input: "function", finish: "function" },
  transcribe: { finish: "function" },
};

/** 按参数定下一次做法：要参数的任务用测试给的参数 */
const SAMPLE_PARAMETERS = { output_language: "en" };

test("每个任务：id 是动作目录里的动作，协议里的两个名字各不相同，能按名字找回来", () => {
  const modes = new Set();
  const configModes = new Set();
  for (const task of TASKS) {
    assert.notEqual(actionOf(task.id), null, `${task.id} 不在动作目录里`);
    assert.equal(findTask(task.id), task);
    assert.equal(taskOfMode(task.mode), task);
    assert.ok(!modes.has(task.mode) && !configModes.has(task.configMode), `${task.id} 的模式名重了`);
    modes.add(task.mode);
    configModes.add(task.configMode);
  }
  assert.equal(findTask("nope"), null);
  assert.equal(taskOfMode("voice_command"), null);
});

test("每个任务：说能在哪几步上做，定下的做法里就正好有那几步，每一副该有的都有", () => {
  for (const task of TASKS) {
    const bound = task.bind(SAMPLE_PARAMETERS);
    assert.equal(bound.id, task.id);
    assert.ok(task.steps.length > 0);
    for (const step of Object.keys(FACES)) {
      assert.equal(step in bound && bound[step] !== undefined, task.steps.includes(step), `${task.id} 的 ${step}`);
      if (!task.steps.includes(step)) continue;
      for (const [name, type] of Object.entries(FACES[step])) {
        assert.equal(typeof bound[step][name], type, `${task.id}.${step}.${name}`);
      }
    }
  }
});

test("语音输入：开口就能定，三种方式都能做；成品只有一段字，离线的原文去掉首尾空白直接交出", () => {
  const dictate = findTask("dictate");
  assert.deepEqual(dictate.parameters, []);
  assert.deepEqual(dictate.steps, ["native", "polish", "transcribe"]);
  const bound = dictate.bind({});
  assert.deepEqual(bound.transcribe.finish("  好的  "), { text: "好的", source: null });
  assert.deepEqual(bound.native.finish("我們後天開會。"), { text: "我们后天开会", source: null });
  assert.deepEqual(bound.polish.finish("好的。", "好的"), { text: "好的", source: null });
});

test("说话的任务都用词典：先要听懂他说的专有名词", () => {
  assert.deepEqual(
    TASKS.filter((task) => task.vocabulary).map(({ id }) => id),
    ["dictate", "translate"],
  );
  for (const task of TASKS) assert.equal(typeof task.vocabulary, "boolean", task.id);
});
