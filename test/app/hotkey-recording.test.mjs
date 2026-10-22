import assert from "node:assert/strict";
import { test } from "node:test";
import { createHotkeyRecording } from "../../src/app/hotkey-recording.mjs";
import { LocalizedError, msg } from "../../src/i18n/index.mjs";

// 主进程这边的录键（docs/hotkey-research.md 5.6）：让小帮手进出录键模式、把它报的集合按定稿规则定下来、查冲突、存，再告诉页面

const RIGHT_OPTION = 0x3d;
const RIGHT_COMMAND = 0x36;
const SPACE = 0x31;
const ESCAPE = 0x35;
const silent = { info() {}, warn() {}, error() {} };

function setup({ saved = { dictate: [["AltRight"]], cancel: [["Escape"]] }, probe, save } = {}) {
  const commands = [];
  const sent = [];
  const stored = [];
  const recording = createHotkeyRecording({
    platform: "darwin",
    record: (on) => commands.push(on),
    probe: probe ?? (async () => ({ conflict: false })),
    chordsOf: (action) => saved[action],
    save:
      save ??
      ((action, chords) => {
        stored.push([action, chords]);
        return {};
      }),
    send: (target, payload) => sent.push([target, payload]),
    log: silent,
  });
  return { recording, commands, sent, stored };
}

const snapshot = (mods = [], keys = []) => ({ event: "recording", on: true, mods, keys });
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("录一个新组合：进录键模式，实时报按着的键，定稿后存进去（加在最后）并退出", async () => {
  const { recording, commands, sent, stored } = setup();
  recording.start("hub", "dictate", null);
  assert.deepEqual(commands, [true]);
  recording.onRecording(snapshot());
  recording.onRecording(snapshot([RIGHT_COMMAND]));
  assert.deepEqual(sent.at(-1), [
    "hub",
    { action: "dictate", index: 1, state: "recording", codes: ["MetaRight"], unknown: false, tooMany: false },
  ]);
  recording.onRecording(snapshot());
  await flush();
  assert.deepEqual(stored, [["dictate", [["AltRight"], ["MetaRight"]]]]);
  assert.deepEqual(commands, [true, false]);
  assert.deepEqual(sent.at(-1), ["hub", { action: "dictate", index: 1, state: "saved" }]);
  assert.equal(recording.recordingFor("hub"), false);
});

test("点了已有的组合：换掉那一个", async () => {
  const { recording, stored } = setup({ saved: { dictate: [["AltRight"], ["MetaRight"]] } });
  recording.start("hub", "dictate", 0);
  recording.onRecording(snapshot());
  recording.onRecording(snapshot([RIGHT_OPTION]));
  recording.onRecording(snapshot([RIGHT_OPTION], [SPACE]));
  recording.onRecording(snapshot([RIGHT_OPTION]));
  await flush();
  assert.deepEqual(stored, [["dictate", [["AltRight", "Space"], ["MetaRight"]]]]);
});

test("存的时候被拒：告诉页面原因，还在录；全松开后重按，照样能存", async () => {
  let tries = 0;
  const { recording, commands, sent, stored } = setup({
    save: (action, chords) => {
      tries += 1;
      if (tries === 1) {
        throw new LocalizedError(msg("settings.invalid", { where: "hotkey.dictate", value: "x", reason: "r" }), {
          cause: new LocalizedError(msg("binding.leftOnly")),
        });
      }
      stored.push([action, chords]);
      return {};
    },
  });
  recording.start("hub", "dictate", 0);
  recording.onRecording(snapshot());
  recording.onRecording(snapshot([0x3a]));
  recording.onRecording(snapshot());
  await flush();
  const rejected = sent.at(-1)[1];
  assert.equal(rejected.state, "rejected");
  assert.deepEqual(rejected.codes, ["AltLeft"]);
  assert.equal(rejected.reason.key, "binding.leftOnly", "给页面的是最里面那句原因，不带设置项的名字");
  assert.deepEqual(commands, [true], "被拒了不退出录键模式");
  recording.onRecording(snapshot([RIGHT_COMMAND]));
  recording.onRecording(snapshot());
  await flush();
  assert.deepEqual(stored, [["dictate", [["MetaRight"]]]]);
  assert.equal(sent.at(-1)[1].state, "saved");
});

test("修饰键加普通键先问小帮手有没有被系统占了：占了就拒，不存", async () => {
  const asked = [];
  const { recording, sent, stored } = setup({
    probe: async (codes) => {
      asked.push(codes);
      return { conflict: true, source: "symbolic" };
    },
  });
  recording.start("hub", "dictate", null);
  recording.onRecording(snapshot());
  recording.onRecording(snapshot([RIGHT_OPTION]));
  recording.onRecording(snapshot([RIGHT_OPTION], [SPACE]));
  recording.onRecording(snapshot([RIGHT_OPTION]));
  await flush();
  assert.deepEqual(asked, [["AltRight", "Space"]]);
  assert.deepEqual(stored, []);
  assert.equal(sent.at(-1)[1].state, "rejected");
  assert.equal(sent.at(-1)[1].reason.key, "hotkeyRecord.systemTaken");
});

test("Windows 上被别的程序登记了：说是别的程序占的", async () => {
  const { recording, sent } = setup({ probe: async () => ({ conflict: true, source: "registered" }) });
  recording.start("hub", "dictate", null);
  recording.onRecording(snapshot());
  recording.onRecording(snapshot([RIGHT_OPTION], [SPACE]));
  recording.onRecording(snapshot([RIGHT_OPTION]));
  await flush();
  assert.equal(sent.at(-1)[1].reason.key, "hotkeyRecord.appTaken");
});

test("单个修饰键不问小帮手", async () => {
  let asked = 0;
  const { recording } = setup({
    probe: async () => {
      asked += 1;
      return { conflict: false };
    },
  });
  recording.start("hub", "dictate", null);
  recording.onRecording(snapshot());
  recording.onRecording(snapshot([RIGHT_COMMAND]));
  recording.onRecording(snapshot());
  await flush();
  assert.equal(asked, 0);
});

test("单按 esc：不录了，退出录键模式，什么也不存", async () => {
  const { recording, commands, sent, stored } = setup();
  recording.start("hub", "dictate", null);
  recording.onRecording(snapshot());
  recording.onRecording(snapshot([], [ESCAPE]));
  recording.onRecording(snapshot());
  await flush();
  assert.deepEqual(stored, []);
  assert.deepEqual(commands, [true, false]);
  assert.deepEqual(sent.at(-1)[1], { action: "dictate", index: 1, state: "ended", reason: "cancelled" });
});

test("录取消这个动作时 esc 就是要录的键", async () => {
  const { recording, stored } = setup({ saved: { dictate: [["AltRight"]], cancel: [["F13"]] } });
  recording.start("hub", "cancel", 0);
  recording.onRecording(snapshot());
  recording.onRecording(snapshot([], [ESCAPE]));
  recording.onRecording(snapshot());
  await flush();
  assert.deepEqual(stored, [["cancel", [["Escape"]]]]);
});

test("页面说不录了（失焦、点了别处）：退出录键模式；别的页面说的不算", () => {
  const { recording, commands, sent } = setup();
  recording.start("hub", "dictate", null);
  recording.stop("onboarding", "blur");
  assert.deepEqual(commands, [true]);
  recording.stop("hub", "blur");
  assert.deepEqual(commands, [true, false]);
  assert.deepEqual(sent.at(-1), ["hub", { action: "dictate", index: 1, state: "ended", reason: "blur" }]);
  // 自己让停的，之后小帮手报的 on:false 不再报给页面
  recording.onRecording({ event: "recording", on: false });
  assert.equal(sent.length, 1);
});

test("小帮手 30 秒到点自己停了：告诉页面", () => {
  const { recording, sent } = setup();
  recording.start("hub", "dictate", null);
  recording.onRecording(snapshot());
  recording.onRecording({ event: "recording", on: false });
  assert.deepEqual(sent.at(-1)[1], { action: "dictate", index: 1, state: "ended", reason: "timeout" });
  assert.equal(recording.recordingFor("hub"), false);
});

test("另一处开始录：前一处收到结束，小帮手重新开始（不先停再开，免得停的回执被当成新一轮到点）", () => {
  const { recording, commands, sent } = setup();
  recording.start("hub", "dictate", null);
  recording.start("onboarding", "dictate", 0);
  assert.deepEqual(commands, [true, true]);
  assert.deepEqual(sent[0], ["hub", { action: "dictate", index: 1, state: "ended", reason: "replaced" }]);
  assert.equal(recording.recordingFor("onboarding"), true);
});

test("刚开始录时到的旧快照不算：等到小帮手报出空的那份才开始认", async () => {
  const { recording, stored } = setup();
  recording.start("hub", "dictate", null);
  // 换之前那一轮里还按着右 ⌘ 的快照晚到了一步
  recording.onRecording(snapshot([RIGHT_COMMAND]));
  recording.onRecording(snapshot());
  await flush();
  assert.deepEqual(stored, [], "旧快照变空不能定稿成右 ⌘");
});

test("小帮手不在了：在录的那一处收到结束", () => {
  const { recording, sent } = setup();
  recording.start("hub", "dictate", null);
  recording.helperGone();
  assert.deepEqual(sent.at(-1)[1], { action: "dictate", index: 1, state: "ended", reason: "helper" });
  assert.equal(recording.recordingFor("hub"), false);
});

test("结束的原因照页面说的记（再点一下、点了别处、离开这一步……）；页面说的不认识就记成 page", () => {
  const { recording, sent } = setup();
  for (const reason of ["reclick", "elsewhere", "left", "unavailable", "closed"]) {
    recording.start("hub", "dictate", null);
    recording.stop("hub", reason);
    assert.equal(sent.at(-1)[1].reason, reason);
  }
  recording.start("hub", "dictate", null);
  recording.stop("hub", "<script>");
  assert.equal(sent.at(-1)[1].reason, "page");
});

test("不认识的动作直接报错", () => {
  const { recording } = setup();
  assert.throws(() => recording.start("hub", "nope", null), /nope/);
});

test("停了马上又开：上一次停的回执晚到，不能当成这一轮到点", () => {
  const { recording, commands } = setup();
  recording.start("hub", "dictate", null);
  recording.stop("hub", "blur");
  recording.start("hub", "cancel", 0);
  // 小帮手对 off 的回执这时才到
  recording.onRecording({ event: "recording", on: false });
  assert.equal(recording.recordingFor("hub"), true);
  assert.deepEqual(commands, [true, false, true]);
  // 真到点了照样认
  recording.onRecording(snapshot());
  recording.onRecording({ event: "recording", on: false });
  assert.equal(recording.recordingFor("hub"), false);
});
