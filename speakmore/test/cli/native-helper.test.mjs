import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHelper, ensureHelper, helperNeedsBuild, helperPaths } from "../../src/cli/native-helper.mjs";

const paths = helperPaths("/pkg");
const statOf = (mtimes) => (file) => (file in mtimes ? { mtimeMs: mtimes[file] } : null);

test("可执行文件和源码的位置", () => {
  assert.deepEqual(paths, { source: "/pkg/native/main.swift", binary: "/pkg/build/key-helper" });
});

test("没有可执行文件，或者源码比它新，就要编译", () => {
  assert.equal(helperNeedsBuild(paths, statOf({ [paths.source]: 10 })), true);
  assert.equal(helperNeedsBuild(paths, statOf({ [paths.source]: 20, [paths.binary]: 10 })), true);
});

test("可执行文件不比源码旧就不用编；装好的包里两个文件时间一样，也不用", () => {
  assert.equal(helperNeedsBuild(paths, statOf({ [paths.source]: 10, [paths.binary]: 20 })), false);
  assert.equal(helperNeedsBuild(paths, statOf({ [paths.source]: 10, [paths.binary]: 10 })), false);
  assert.equal(helperNeedsBuild(paths, statOf({ [paths.binary]: 10 })), false);
});

test("平时只编本机的架构", () => {
  const calls = [];
  buildHelper("/pkg", { run: (command, args) => calls.push([command, ...args]), mkdir: () => {}, remove: () => {} });
  assert.deepEqual(calls, [["swiftc", "-O", "-o", "/pkg/build/key-helper", "/pkg/native/main.swift"]]);
});

test("发布时两种芯片各编一份再合成一个文件，中间文件删掉", () => {
  const calls = [];
  const removed = [];
  buildHelper("/pkg", {
    universal: true,
    run: (command, args) => calls.push([command, ...args]),
    mkdir: () => {},
    remove: (file) => removed.push(file),
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.slice(0, 2).map((call) => call[call.indexOf("-target") + 1]),
    ["arm64-apple-macos12.0", "x86_64-apple-macos12.0"],
  );
  assert.deepEqual(calls[2], [
    "lipo",
    "-create",
    "-output",
    "/pkg/build/key-helper",
    "/pkg/build/key-helper-arm64",
    "/pkg/build/key-helper-x86_64",
  ]);
  assert.deepEqual(removed, ["/pkg/build/key-helper-arm64", "/pkg/build/key-helper-x86_64"]);
});

test("没装编译工具时说清楚要装什么", () => {
  const missing = () => {
    throw Object.assign(new Error("spawnSync swiftc ENOENT"), { code: "ENOENT" });
  };
  assert.throws(
    () => buildHelper("/pkg", { run: missing, mkdir: () => {}, remove: () => {} }),
    /xcode-select --install/,
  );
});

test("编译出错时把编译器的话带出来", () => {
  const broken = () => {
    throw Object.assign(new Error("Command failed"), {
      status: 1,
      stderr: Buffer.from("main.swift:3: error: 不认识的名字"),
    });
  };
  assert.throws(() => buildHelper("/pkg", { run: broken, mkdir: () => {}, remove: () => {} }), /不认识的名字/);
});

test("ensureHelper：要编才编，并说明这次编没编", () => {
  const calls = [];
  const deps = { run: (command) => calls.push(command), mkdir: () => {}, remove: () => {} };
  assert.equal(ensureHelper("/pkg", { ...deps, stat: statOf({ [paths.source]: 10, [paths.binary]: 20 }) }), false);
  assert.equal(calls.length, 0);
  assert.equal(ensureHelper("/pkg", { ...deps, stat: statOf({ [paths.source]: 10 }) }), true);
  assert.deepEqual(calls, ["swiftc"]);
});
