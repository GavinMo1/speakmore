import assert from "node:assert/strict";
import { test } from "node:test";
import { describeError, permissionGranted, permissionText } from "../../../src/renderer/shared/setup-text.mjs";

test("主进程的报错去掉 Electron 加的前缀，只留那句话", () => {
  const wrapped = new Error("Error invoking remote method 'setup:set-theme': Error: theme 要是 ink / cinnabar 之一");
  assert.equal(describeError(wrapped), "theme 要是 ink / cinnabar 之一");
  assert.equal(describeError(new Error("Error invoking remote method 'a': TypeError: 不认识的热键")), "不认识的热键");
  assert.equal(describeError(new Error("网断了")), "网断了");
  assert.equal(describeError("字符串也行"), "字符串也行");
});

test("权限给没给：麦克风看系统给的状态，另两项是小帮手报的真假，还没报上来是 null", () => {
  assert.equal(permissionGranted("microphone", "granted"), true);
  assert.equal(permissionGranted("microphone", "not-determined"), false);
  assert.equal(permissionGranted("listen", true), true);
  assert.equal(permissionGranted("trusted", null), null);
});

test("麦克风从没问过时按钮写\"授权\"：要先让系统弹框，系统设置的列表里才有这个应用", () => {
  assert.deepEqual(permissionText("microphone", "not-determined"), ["还没授权", "problem", "授权"]);
  assert.deepEqual(permissionText("listen", null), ["检查中…", "pending", "打开系统设置"]);
});
