import assert from "node:assert/strict";
import { test } from "node:test";
import { createKeyManager } from "../../../src/app/keys/key-manager.mjs";
import { describeKeyError } from "../../../src/app/service.mjs";

const OFFLINE = () => new TypeError("fetch failed");
/** Gemini 偶尔回的 503（实测到的原文） */
const BUSY = () =>
  new Error('{"error":{"code":503,"message":"The service is currently unavailable.","status":"UNAVAILABLE"}}');
const INVALID = () => new Error('{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT"}}');
const NO_SUCH_MODEL = () =>
  new Error('{"error":{"code":404,"message":"models/gemini-nope is not found.","status":"NOT_FOUND"}}');

/**
 * 假的听写服务。verdicts：key → 拿它去验证时抛什么错（不写就是通过）。
 * 和真的一样：允许"先用着"时，连不上不算失败。
 */
function fakeService(verdicts = {}) {
  const service = {
    calls: [],
    /** 正在用的那把；没有时是 null */
    using: null,
    async useKey(apiKey, { allowUnverified = false } = {}) {
      service.calls.push({ useKey: apiKey, allowUnverified });
      const error = verdicts[apiKey]?.();
      if (error && !(allowUnverified && describeKeyError(error).cause === "unavailable")) throw error;
      service.using = apiKey;
      return { verified: !error };
    },
    async verify() {
      service.calls.push({ verify: service.using });
      const error = verdicts[service.using]?.();
      if (error) throw error;
    },
    forgetKey() {
      service.using = null;
    },
  };
  return service;
}

function fakeStore(initial = null) {
  const store = {
    value: initial,
    load() {
      if (store.value instanceof Error) throw store.value;
      return store.value;
    },
    save(key) {
      if (store.failOnSave) throw new Error("钥匙串不可用");
      store.value = key;
    },
    clear() {
      store.value = null;
    },
  };
  return store;
}

function setup({ verdicts, stored = null, env = {}, external = false } = {}) {
  const service = external ? null : fakeService(verdicts);
  const keyStore = fakeStore(stored);
  const logged = [];
  const record = (level) => (event, fields) => logged.push({ level, event, ...fields });
  let changes = 0;
  const keys = createKeyManager({
    service,
    keyStore,
    env,
    log: { info: record("info"), warn: record("warn"), error: record("error") },
    onChange: () => changes++,
  });
  return { keys, service, keyStore, logged, changes: () => changes };
}

// ---------- 启动时找 key ----------

test("没有环境变量也没存过：还没有 key，不去打扰服务", async () => {
  const { keys, service } = setup();
  assert.deepEqual(await keys.loadAtStartup(), { state: "missing", source: null, problem: null });
  assert.deepEqual(service.calls, []);
});

test("存着的那把通过验证：可以用；途中的每一步都通知出去", async () => {
  const { keys, service, changes } = setup({ stored: "stored-key" });
  assert.deepEqual(await keys.loadAtStartup(), { state: "ready", source: "stored", problem: null, verified: true });
  assert.equal(keys.current.state, "ready");
  assert.equal(service.using, "stored-key");
  // 正在验证 → 可以用
  assert.equal(changes(), 2);
});

test("环境变量里有就用它，不去读存着的那把", async () => {
  const { keys, service, keyStore } = setup({ stored: "stored-key", env: { GEMINI_API_KEY: " env-key " } });
  keyStore.load = () => assert.fail("不该读存着的");
  assert.equal((await keys.loadAtStartup()).source, "env");
  assert.equal(service.using, "env-key");
});

test("启动时连不上 Gemini：存着的那把照样启用，如实标成还没验证", async () => {
  const { keys, service, logged } = setup({ stored: "stored-key", verdicts: { "stored-key": OFFLINE } });
  assert.deepEqual(await keys.loadAtStartup(), { state: "ready", source: "stored", problem: null, verified: false });
  assert.equal(service.using, "stored-key");
  assert.deepEqual(service.calls, [{ useKey: "stored-key", allowUnverified: true }]);
  assert.deepEqual(logged.at(-1), { level: "info", event: "key_ready", source: "stored", verified: false });
});

test("启动时 Gemini 一时不可用（503）：和没网一样先用着，不说成模型设置有问题", async () => {
  const { keys, service } = setup({ stored: "stored-key", verdicts: { "stored-key": BUSY } });
  assert.deepEqual(await keys.loadAtStartup(), { state: "ready", source: "stored", problem: null, verified: false });
  assert.equal(service.using, "stored-key");
});

test("启动时 key 无效、或者 Gemini 拒绝了请求：不能用，并分清是哪一种", async () => {
  const invalid = setup({ stored: "revoked", verdicts: { revoked: INVALID } });
  const rejected = await invalid.keys.loadAtStartup();
  assert.deepEqual(
    { state: rejected.state, source: rejected.source, cause: rejected.cause },
    { state: "rejected", source: "stored", cause: "key" },
  );
  assert.match(rejected.problem, /无效/);
  assert.equal(invalid.service.using, null);

  const wrongModel = setup({ stored: "good", verdicts: { good: NO_SUCH_MODEL } });
  const other = await wrongModel.keys.loadAtStartup();
  assert.equal(other.cause, "other");
  assert.match(other.problem, /gemini-nope is not found/);
});

test("存着的 key 解不开：说读不出来了，请用户重新填", async () => {
  const { keys, service } = setup({ stored: new Error("钥匙串里的密钥没了") });
  const state = await keys.loadAtStartup();
  assert.deepEqual({ state: state.state, source: state.source }, { state: "unreadable", source: "stored" });
  assert.match(state.problem, /读不出来/);
  assert.deepEqual(service.calls, []);
});

test("环境变量里的 key 带着换行：直接判成不能用，不交给服务，它的内容不出现在任何地方", async () => {
  const { keys, service, logged } = setup({ env: { GEMINI_API_KEY: "line-one-SECRET\nline-two-SECRET" } });
  const state = await keys.loadAtStartup();
  assert.deepEqual(
    { state: state.state, source: state.source, cause: state.cause },
    { state: "rejected", source: "env", cause: "key" },
  );
  assert.match(state.problem, /空格或换行/);
  assert.deepEqual(service.calls, []);
  assert.doesNotMatch(JSON.stringify([state, logged]), /SECRET/);
});

test("连的是单独启动的服务端：key 在那边，这里不管", async () => {
  const { keys } = setup({ external: true, stored: "stored-key" });
  assert.deepEqual(await keys.loadAtStartup(), { state: "ready", source: "external", problem: null });
  assert.match((await keys.save("new-key")).problem, /SPEAKMORE_SERVER_URL/);
  await keys.forget();
  assert.equal(keys.current.source, "external");
});

// ---------- 换一把 ----------

test("存一把新的：验证通过才存下来并开始用", async () => {
  const { keys, service, keyStore } = setup();
  assert.deepEqual(await keys.save("  new-key \n"), { ok: true });
  assert.equal(keyStore.value, "new-key");
  assert.equal(service.using, "new-key");
  assert.deepEqual(keys.current, { state: "ready", source: "stored", problem: null, verified: true });
});

test("什么都没填：不验证也不存", async () => {
  const { keys, service } = setup();
  for (const empty of ["", "   ", undefined, 42]) {
    assert.match((await keys.save(empty)).problem, /还没有填/);
  }
  assert.deepEqual(service.calls, []);
});

test("新填的 key 带着换行：当场拒绝，不交给服务，它的内容不出现在回答和日志里", async () => {
  const { keys, service, keyStore, logged } = setup({ stored: "old-key" });
  await keys.loadAtStartup();
  const result = await keys.save("line-one-SECRET\nline-two-SECRET");
  assert.equal(result.ok, false);
  assert.match(result.problem, /这把 key 里有空格或换行/);
  assert.equal(service.using, "old-key");
  assert.equal(keyStore.value, "old-key");
  assert.equal(keys.current.state, "ready");
  assert.doesNotMatch(JSON.stringify([result, logged, keys.current]), /SECRET/);
});

test("新填的 key 没连上网验证不了：不算通过（它从没验证过），原来的状态不变", async () => {
  const withOld = setup({ stored: "old-key", verdicts: { "new-key": OFFLINE } });
  await withOld.keys.loadAtStartup();
  const result = await withOld.keys.save("new-key");
  assert.equal(result.ok, false);
  assert.match(result.problem, /连不上/);
  assert.deepEqual(withOld.service.calls.at(-1), { useKey: "new-key", allowUnverified: false });
  assert.equal(withOld.service.using, "old-key");
  assert.equal(withOld.keyStore.value, "old-key");
  assert.deepEqual(withOld.keys.current, { state: "ready", source: "stored", problem: null, verified: true });

  // 原来就没有 key 的，失败后仍然是"还没有"，而不是"存着的那把不能用"
  const empty = setup({ verdicts: { "new-key": INVALID } });
  assert.match((await empty.keys.save("new-key")).problem, /无效/);
  assert.deepEqual(empty.keys.current, { state: "missing", source: null, problem: null });
  assert.equal(empty.keyStore.value, null);
});

test("验证过了但存不下来：这次能用，如实说下次要重填", async () => {
  const { keys, service, keyStore } = setup();
  keyStore.failOnSave = true;
  const result = await keys.save("new-key");
  assert.equal(result.ok, false);
  assert.match(result.problem, /没存下来.*钥匙串不可用/);
  assert.equal(service.using, "new-key");
  assert.equal(keys.current.state, "ready");
});

test("验证时的报错里带着 key 的话，回答和日志里都抹掉", async () => {
  const leaky = () => new TypeError('Headers.append: "SECRET-key" is an invalid header value.');
  const { keys, logged } = setup({ verdicts: { "SECRET-key": leaky } });
  const result = await keys.save("SECRET-key");
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify([result, logged]), /SECRET/);
  assert.equal(logged.at(-1).event, "key_rejected");
});

/** 让存着的那把在验证时卡住，直到测试放行 */
function holdStartup(service) {
  let release;
  const useKey = service.useKey;
  service.useKey = async (apiKey, options) => {
    if (apiKey === "stored-key") await new Promise((resolve) => (release = resolve));
    return useKey(apiKey, options);
  };
  return async () => {
    await new Promise((resolve) => setImmediate(resolve));
    release();
  };
}

test("启动时的验证还没回来又存了一把新的：一个一个来，最后用的是后来的那把", async () => {
  const { keys, service, keyStore } = setup({ stored: "stored-key" });
  const release = holdStartup(service);
  const pending = [keys.loadAtStartup(), keys.save("new-key")];
  await release();
  await Promise.all(pending);
  assert.equal(service.using, "new-key");
  assert.equal(keyStore.value, "new-key");
  assert.equal(keys.current.state, "ready");
});

test("启动时的验证还没回来又存了一把不能用的：回到的是启动验证完的状态，不会停在“正在验证”", async () => {
  const { keys, service } = setup({ stored: "stored-key", verdicts: { "bad-key": INVALID } });
  const release = holdStartup(service);
  const pending = [keys.loadAtStartup(), keys.save("bad-key")];
  await release();
  const [, saved] = await Promise.all(pending);
  assert.equal(saved.ok, false);
  assert.equal(service.using, "stored-key");
  assert.deepEqual(keys.current, { state: "ready", source: "stored", problem: null, verified: true });
});

// ---------- 删掉 ----------

test("删掉：存着的没了，服务也不再用它", async () => {
  const { keys, service, keyStore } = setup({ stored: "stored-key" });
  await keys.loadAtStartup();
  await keys.forget();
  assert.equal(keyStore.value, null);
  assert.equal(service.using, null);
  assert.deepEqual(keys.current, { state: "missing", source: null, problem: null });
});

test("启动时的验证还没回来就点了删掉：验证回来之后 key 仍然是删掉的，不会又被启用", async () => {
  const { keys, service, keyStore } = setup({ stored: "stored-key" });
  const release = holdStartup(service);
  const pending = [keys.loadAtStartup(), keys.forget()];
  await release();
  await Promise.all(pending);
  assert.equal(service.using, null);
  assert.equal(keyStore.value, null);
  assert.equal(keys.current.state, "missing");
});

test("删的时候出了错（文件删不掉）：照实抛出来，后面再存 key 不受连累", async () => {
  const { keys, service, keyStore } = setup({ stored: "stored-key" });
  await keys.loadAtStartup();
  keyStore.clear = () => {
    throw new Error("删不掉");
  };
  await assert.rejects(keys.forget(), /删不掉/);
  assert.deepEqual(await keys.save("new-key"), { ok: true });
  assert.equal(service.using, "new-key");
});

// ---------- 启动时没验证成的，之后补上 ----------

test("补验证：连上网之后变成验证通过", async () => {
  const verdicts = { "stored-key": OFFLINE };
  const { keys, service } = setup({ stored: "stored-key", verdicts });
  await keys.loadAtStartup();

  await keys.reverify();
  assert.equal(keys.current.verified, false, "还是连不上：先用着，状态不变");
  assert.equal(service.using, "stored-key");

  delete verdicts["stored-key"];
  await keys.reverify();
  assert.deepEqual(keys.current, { state: "ready", source: "stored", problem: null, verified: true });
});

test("补验证：连上之后发现 key 无效，改判成不能用，服务不再用它", async () => {
  const verdicts = { "env-key": OFFLINE };
  const { keys, service } = setup({ env: { GEMINI_API_KEY: "env-key" }, verdicts });
  await keys.loadAtStartup();
  verdicts["env-key"] = INVALID;
  await keys.reverify();
  assert.deepEqual(
    { state: keys.current.state, source: keys.current.source, cause: keys.current.cause },
    { state: "rejected", source: "env", cause: "key" },
  );
  assert.equal(service.using, null);
});

test("补验证：已经验证过的、没有 key 的，都不再发请求；同时来两次只验一次", async () => {
  const verified = setup({ stored: "stored-key" });
  await verified.keys.loadAtStartup();
  await verified.keys.reverify();
  const missing = setup();
  await missing.keys.reverify();
  assert.ok(![...verified.service.calls, ...missing.service.calls].some((call) => "verify" in call));

  const pending = setup({ stored: "stored-key", verdicts: { "stored-key": OFFLINE } });
  await pending.keys.loadAtStartup();
  await Promise.all([pending.keys.reverify(), pending.keys.reverify()]);
  assert.equal(pending.service.calls.filter((call) => "verify" in call).length, 1);
});
