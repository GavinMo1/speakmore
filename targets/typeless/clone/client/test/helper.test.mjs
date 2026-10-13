import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { test } from "node:test";
import { startHelper } from "../src/main/helper.mjs";

// 用一小段 Node 脚本冒充原生小帮手：启动时报 ready 和一次热键按下，收到 paste 就按文字内容决定怎么回
const FAKE_HELPER = `
const emit = (o) => console.log(JSON.stringify(o));
emit({ event: "ready", listen: true, trusted: true });
emit({ event: "hotkey", down: true });
console.log("这一行不是 JSON");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, text } = JSON.parse(line);
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
  await once(events, "hotkey");
  assert.deepEqual(seen, [
    { event: "ready", listen: true, trusted: true },
    { event: "hotkey", down: true },
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

test("两次粘贴各回各的", async () => {
  const { helper } = start();
  const results = await Promise.all([helper.paste("甲"), helper.paste("没权限")]);
  assert.deepEqual(
    results.map((result) => result.ok),
    [true, false],
  );
  helper.stop();
});

test("小帮手中途退出：等着的粘贴失败，之后的粘贴直接失败", async () => {
  const { helper, events } = start();
  const exited = once(events, "exit");
  await assert.rejects(helper.paste("退出"), /退出了/);
  const [exit] = await exited;
  assert.equal(exit.code, 3);
  await assert.rejects(helper.paste("再来"), /没有在运行/);
});

test("可执行文件不存在时，粘贴失败而不是一直等", async () => {
  const errors = [];
  const helper = startHelper("/不存在/的/程序", {
    onEvent() {},
    log: { warn() {}, error: (name) => errors.push(name) },
  });
  await assert.rejects(helper.paste("x"));
  assert.ok(errors.includes("helper_spawn_failed"));
});
