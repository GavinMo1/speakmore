import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { buildHelper, ensureHelper, helperNeedsBuild, helperPaths } from "../../src/cli/native-helper.mjs";

const paths = helperPaths("/pkg");
const SOURCE = "print(1)";
/** 假的文件系统：路径 → 内容，没有的文件读出来是 null */
const filesOf = (files) => (file) => (file in files ? Buffer.from(files[file]) : null);
const stampOf = (source) => createHash("sha256").update(source).digest("hex");

/** 编译用到的外部动作全换成记录 */
function fakeBuild(run) {
  const build = {
    written: {},
    removed: [],
    options: {
      run,
      mkdir: () => {},
      read: filesOf({ [paths.source]: SOURCE }),
      write: (file, content) => {
        build.written[file] = content;
      },
      remove: (file) => build.removed.push(file),
    },
  };
  return build;
}

test("可执行文件、源码、指纹文件的位置", () => {
  assert.deepEqual(paths, {
    source: "/pkg/native/main.swift",
    binary: "/pkg/build/key-helper",
    stamp: "/pkg/build/key-helper.source-sha256",
  });
});

test("没有可执行文件就要编译", () => {
  assert.equal(helperNeedsBuild(paths, filesOf({ [paths.source]: SOURCE })), true);
});

test("可执行文件是从现在这份源码编出来的，就不用再编", () => {
  const files = { [paths.source]: SOURCE, [paths.binary]: "x", [paths.stamp]: `${stampOf(SOURCE)}\n` };
  assert.equal(helperNeedsBuild(paths, filesOf(files)), false);
});

test("源码改过，或者说不清可执行文件是从哪份源码来的，就要重新编", () => {
  const built = { [paths.binary]: "x", [paths.stamp]: stampOf(SOURCE) };
  assert.equal(helperNeedsBuild(paths, filesOf({ ...built, [paths.source]: "print(2)" })), true);
  assert.equal(helperNeedsBuild(paths, filesOf({ [paths.source]: SOURCE, [paths.binary]: "x" })), true);
});

test("只有可执行文件、没有源码时照用不误", () => {
  assert.equal(helperNeedsBuild(paths, filesOf({ [paths.binary]: "x" })), false);
});

test("平时只编本机的架构，编完记下是从哪份源码来的", () => {
  const calls = [];
  const build = fakeBuild((command, args) => calls.push([command, ...args]));
  buildHelper("/pkg", build.options);
  assert.deepEqual(calls, [["swiftc", "-O", "-o", "/pkg/build/key-helper", "/pkg/native/main.swift"]]);
  assert.deepEqual(build.written, { [paths.stamp]: `${stampOf(SOURCE)}\n` });
});

test("发布时两种芯片各编一份再合成一个文件，中间文件删掉", () => {
  const calls = [];
  const build = fakeBuild((command, args) => calls.push([command, ...args]));
  buildHelper("/pkg", { ...build.options, universal: true });
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
  assert.deepEqual(build.removed, ["/pkg/build/key-helper-arm64", "/pkg/build/key-helper-x86_64"]);
  assert.deepEqual(Object.keys(build.written), [paths.stamp]);
});

test("没装编译工具时说清楚要装什么；没编成就不留指纹，免得下次以为已经编好了", () => {
  const build = fakeBuild(() => {
    throw Object.assign(new Error("spawnSync swiftc ENOENT"), { code: "ENOENT" });
  });
  assert.throws(() => buildHelper("/pkg", build.options), /xcode-select --install/);
  assert.deepEqual(build.written, {});
});

test("编译出错时把编译器的话带出来", () => {
  const build = fakeBuild(() => {
    throw Object.assign(new Error("Command failed"), {
      status: 1,
      stderr: Buffer.from("main.swift:3: error: 不认识的名字"),
    });
  });
  assert.throws(() => buildHelper("/pkg", build.options), /不认识的名字/);
});

test("ensureHelper：要编才编，动手之前先说一声，并说明这次编没编", () => {
  const calls = [];
  const said = [];
  const build = fakeBuild((command) => calls.push(command));
  const onBuild = () => said.push("要编了");
  const upToDate = filesOf({ [paths.source]: SOURCE, [paths.binary]: "x", [paths.stamp]: stampOf(SOURCE) });

  assert.equal(ensureHelper("/pkg", { ...build.options, read: upToDate, onBuild }), false);
  assert.deepEqual([calls, said], [[], []]);
  assert.equal(ensureHelper("/pkg", { ...build.options, onBuild }), true);
  assert.deepEqual([calls, said], [["swiftc"], ["要编了"]]);
});
