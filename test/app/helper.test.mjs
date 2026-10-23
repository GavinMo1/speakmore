import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { test } from "node:test";
import { startHelper } from "../../src/app/helper.mjs";

// 用一小段 Node 脚本冒充原生小帮手：启动时报 ready 和一次绑定按下，收到 paste 就按文字内容决定怎么回；
// 收到 bind 回 bound（把收到的表原样带回来）；收到 capture 就当作用户点了划出来的第一块，
// 收到 release 就当作被打断，把收到的命令原样报回来；record 回一份空快照；probe 按 key 决定冲不冲突（不回、乱回 id 的也有）；
// info 回 fnUsage
const FAKE_HELPER = `
const emit = (o) => console.log(JSON.stringify(o));
emit({ event: "ready", listen: true, trusted: true });
emit({ event: "binding", id: "dictate#0", down: true });
console.log("这一行不是 JSON");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.cmd === "bind") return emit({ event: "bound", rejected: [], got: command.bindings });
  if (command.cmd === "capture") return emit({ event: "click", id: command.regions[0]?.id ?? null, regions: command.regions });
  if (command.cmd === "release") return emit({ event: "interrupted", id: "dictate#0", got: command });
  if (command.cmd === "record") return emit(command.on ? { event: "recording", on: true, mods: [], keys: [] } : { event: "recording", on: false });
  if (command.cmd === "probe") {
    if (command.key === 0) return;
    if (command.key === 1) emit({ event: "probed", id: command.id + 100, conflict: true });
    return emit({ event: "probed", id: command.id, conflict: command.key === 49, ...(command.key === 49 ? { source: "symbolic" } : {}), got: command });
  }
  if (command.cmd === "info") return emit({ event: "info", fnUsage: 2 });
  if (command.cmd === "selection") {
    if (command.id === 2) return;
    return emit({ event: "selection", id: command.id, text: "picked",
      rect: { x: 10, y: 20, width: 300, height: 18 }, via: "ax", ms: 9 });
  }
  const { id, text } = command;
  if (text === "不回") return;
  if (text === "退出") process.exit(3);
  emit({ event: "pasted", id, ok: text !== "没权限", ...(text === "没权限" ? { reason: "not_trusted" } : {}) });
}).on("close", () => process.exit(0));
`;

function start() {
  const events = new EventEmitter();
  const seen = [];
  const warnings = [];
  const helper = startHelper(process.execPath, {
    args: ["-e", FAKE_HELPER],
    onEvent: (event) => {
      seen.push(event);
      events.emit(event.event, event);
    },
    log: { warn: (name) => warnings.push(name), error: (name) => warnings.push(name) },
  });
  return { helper, events, seen, warnings };
}

test("转发按键事件；不是 JSON 的行记一条警告，不影响后面", async () => {
  const { helper, events, seen, warnings } = start();
  await once(events, "binding");
  assert.deepEqual(seen, [
    { event: "ready", listen: true, trusted: true },
    { event: "binding", id: "dictate#0", down: true },
  ]);
  assert.deepEqual(await helper.paste("你好"), { ok: true, reason: null });
  assert.deepEqual(warnings, ["helper_bad_line"]);
  helper.stop();
  const [exit] = await once(events, "exit");
  assert.equal(exit.code, 0);
});

test("没有辅助功能权限时，paste 返回 ok 为 false 和原因", async () => {
  const { helper } = start();
  assert.deepEqual(await helper.paste("没权限"), { ok: false, reason: "not_trusted" });
  helper.stop();
});

test("说了停以后再发命令（退出时窗口关了、录键收尾）：不往关掉的标准输入里写，不抛错", async () => {
  const { helper, events } = start();
  await once(events, "ready");
  helper.stop();
  helper.record(false);
  helper.bind([]);
  const [exit] = await once(events, "exit");
  assert.equal(exit.code, 0);
});

test("两次粘贴各回各的", async () => {
  const { helper } = start();
  const results = await Promise.all([helper.paste("甲"), helper.paste("没权限")]);
  assert.deepEqual(
    results.map((result) => result.ok),
    [true, false],
  );
  helper.stop();
});

test("下发绑定表：命令原样送到，回执往上转", async () => {
  const { helper, events } = start();
  const table = [
    { id: "dictate#0", mods: [61], when: "always" },
    { id: "cancel#0", mods: [], key: 53, when: "capturing" },
  ];
  const bound = once(events, "bound");
  helper.bind(table);
  assert.deepEqual((await bound)[0], { event: "bound", rejected: [], got: table });
  helper.stop();
});

test("开始截和不截了：命令原样送到，截到的点击和别的事件往上转", async () => {
  const { helper, events } = start();
  const regions = [
    { id: "cancel", x: 700, y: 900, width: 28, height: 28 },
    { id: "confirm", x: 812, y: 900, width: 28, height: 28 },
  ];
  const clicked = once(events, "click");
  helper.capture(regions);
  assert.deepEqual((await clicked)[0], { event: "click", id: "cancel", regions });
  // 划词卡片要块外的按下：带上 outside
  const outside = once(events, "click");
  helper.capture(regions, { outside: true });
  assert.deepEqual((await outside)[0].regions, regions);
  const interrupted = once(events, "interrupted");
  helper.release();
  assert.deepEqual((await interrupted)[0], { event: "interrupted", id: "dictate#0", got: { cmd: "release" } });
  helper.stop();
});

test("小帮手不在了之后再下发绑定、说开始截、不截了：什么也不做，不报错", async () => {
  const { helper, events } = start();
  const exited = once(events, "exit");
  helper.stop();
  await exited;
  helper.bind([]);
  helper.capture([]);
  helper.release();
});

test("小帮手中途退出：等着的粘贴失败，之后的粘贴直接失败", async () => {
  const { helper, events } = start();
  const exited = once(events, "exit");
  await assert.rejects(helper.paste("退出"), /退出了/);
  const [exit] = await exited;
  assert.equal(exit.code, 3);
  await assert.rejects(helper.paste("再来"), /没有在运行/);
});

test("可执行文件不存在时，粘贴失败而不是一直等；并且照样报一次“退出了”，上面才知道它没在", async () => {
  const errors = [];
  const seen = [];
  const helper = startHelper("/不存在/的/程序", {
    onEvent: (event) => seen.push(event),
    log: { warn() {}, error: (name) => errors.push(name) },
  });
  await assert.rejects(helper.paste("x"));
  assert.ok(errors.includes("helper_spawn_failed"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(
    seen.map((event) => event.event),
    ["exit"],
  );
  await assert.rejects(helper.paste("再来"), /没有在运行/);
});

test("录键：命令原样送到，快照往上转", async () => {
  const { helper, events } = start();
  const on = once(events, "recording");
  helper.record(true);
  assert.deepEqual((await on)[0], { event: "recording", on: true, mods: [], keys: [] });
  const off = once(events, "recording");
  helper.record(false);
  assert.deepEqual((await off)[0], { event: "recording", on: false });
  helper.stop();
});

test("探测冲突：按 id 认回各自的回执，不往上转；回执不来时按不冲突算，不一直等", async () => {
  const { helper, seen } = start();
  const [taken, free, wrongId] = await Promise.all([
    helper.probe({ mods: [55], key: 49 }),
    helper.probe({ mods: [61], key: 105 }),
    helper.probe({ mods: [61], key: 1 }),
  ]);
  assert.deepEqual(taken, { conflict: true, source: "symbolic" });
  assert.deepEqual(free, { conflict: false });
  assert.deepEqual(wrongId, { conflict: false });
  const started = Date.now();
  assert.deepEqual(await helper.probe({ mods: [61], key: 0 }, { timeoutMs: 50 }), { conflict: false, timedOut: true });
  assert.ok(Date.now() - started < 1000);
  assert.ok(!seen.some((event) => event.event === "probed"), "回执不往上转");
  helper.stop();
});

test("问系统信息：回执交给调用方，不往上转", async () => {
  const { helper, seen } = start();
  assert.deepEqual(await helper.info(), { fnUsage: 2 });
  assert.ok(!seen.some((event) => event.event === "info"));
  helper.stop();
});

test("取选区：按 id 认回各自的回执，不往上转；回执不来时按没取到算，不一直等", async () => {
  const { helper, seen } = start();
  assert.deepEqual(await helper.selection(), {
    text: "picked",
    rect: { x: 10, y: 20, width: 300, height: 18 },
    via: "ax",
    reason: null,
    ms: 9,
  });
  assert.deepEqual(await helper.selection({ timeoutMs: 50 }), {
    text: "",
    rect: null,
    via: null,
    reason: "timeout",
    ms: null,
  });
  assert.ok(!seen.some((event) => event.event === "selection"));
  helper.stop();
});

test("小帮手不在了：探测按不冲突算，系统信息是空的", async () => {
  const { helper, events } = start();
  const exited = once(events, "exit");
  helper.stop();
  await exited;
  helper.record(true);
  assert.deepEqual(await helper.probe({ mods: [55], key: 49 }), { conflict: false, timedOut: true });
  assert.deepEqual(await helper.info(), {});
  assert.equal((await helper.selection()).reason, "gone");
});
