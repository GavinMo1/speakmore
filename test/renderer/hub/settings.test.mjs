import assert from "node:assert/strict";
import { test } from "node:test";
import { fixTarget } from "../../../src/renderer/hub/settings.mjs";

const setup = (key, permissions = {}, helper = "running") => ({
  key: { state: key },
  helper,
  permissions: { microphone: "granted", listen: true, trusted: true, ...permissions },
});

test("还差 key：去侧栏模型一页的密钥表", () => {
  const keys = { route: "models", tab: "keys" };
  assert.deepEqual(fixTarget(setup("missing")), keys);
  assert.deepEqual(fixTarget(setup("rejected", { listen: false })), keys);
  assert.deepEqual(fixTarget(setup("unreadable")), keys);
});

test("key 没问题、正在验证时，差的是权限就去权限那一页", () => {
  assert.deepEqual(fixTarget(setup("ready", { microphone: "denied" })), { pane: "permissions" });
  assert.deepEqual(fixTarget(setup("checking", { listen: false })), { pane: "permissions" });
  // 只缺辅助功能也算：能用但打了折扣，补上它的地方也在权限页
  assert.deepEqual(fixTarget(setup("ready", { trusted: false })), { pane: "permissions" });
});

test("什么都不缺、权限还没报上来：去设置的第一页", () => {
  assert.deepEqual(fixTarget(setup("ready")), { pane: "general" });
  assert.deepEqual(fixTarget(setup("ready", { listen: null, trusted: null })), { pane: "general" });
});

test("按键监听的小程序停了：去权限那一页，重新检查在那里", () => {
  assert.deepEqual(fixTarget(setup("ready", { listen: null, trusted: null }, "stopped")), { pane: "permissions" });
});
