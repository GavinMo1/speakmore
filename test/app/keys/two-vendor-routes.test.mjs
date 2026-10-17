import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createKeyManager } from "../../../src/app/keys/key-manager.mjs";
import { createModeSwitch } from "../../../src/app/modes.mjs";
import { startService } from "../../../src/app/service.mjs";
import { createTranslator } from "../../../src/i18n/index.mjs";
import { keyVendorOf } from "../../../src/server/modes.mjs";
import { VENDORS } from "../../../src/server/vendors.mjs";
import { resolveSettings, routeOf } from "../../../src/storage/settings.mjs";

// 一条路线要两家 key 时（第一跳交给云端、润色交给另一家）整套拼起来走一遍：真的服务、真的 refiner、真的 key 管理和模式切换，
// 只有各家的接口是假的（下面的 fetch）。key-manager.test.mjs 用的假服务不管 keys，这几种错在那边测不出来。

const zh = createTranslator("zh-CN");
const GOOD = new Set(["bl-good", "ds-good", "kimi-good"]);

/** 这个文件里发出去的请求：哪个地址、带的哪把 key */
const requests = [];
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init) => {
  const key = String(init.headers?.Authorization ?? "").replace(/^Bearer /, "");
  requests.push({ url: String(url), key });
  if (!GOOD.has(key)) return reply({ error: { code: "invalid_api_key", message: "Incorrect API key provided" } }, 401);
  const body = JSON.parse(init.body);
  return reply({
    model: body.model,
    choices: [{ message: { content: "" }, finish_reason: "length" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, seconds: 1 },
  });
};

const homes = [];
after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

const fakeStore = (value = null) => ({
  value,
  load() {
    return this.value;
  },
  save(next) {
    this.value = next;
  },
  clear() {
    this.value = null;
  },
  exists() {
    return this.value !== null;
  },
});
const silent = { info() {}, warn() {}, error() {} };

/** 照页面那样听写一次（协议见 src/server/server.mjs），交回服务最后说的那句 */
function dictateOnce(url) {
  const chunk = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(60)]);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const audioId = crypto.randomUUID();
    socket.onerror = () => reject(new Error("连不上内置服务"));
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "start_audio", audio_id: audioId }));
      socket.send(JSON.stringify({ type: "set_audio_chunk_info", audio_id: audioId, index: 1, size: chunk.length }));
      socket.send(chunk);
      socket.send(JSON.stringify({ type: "end_audio", audio_id: audioId }));
    };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.K !== "audio_processing_completed" && message.K !== "audio_processing_error") return;
      socket.close();
      resolve(message);
    };
  });
}

/** 第一跳交给百炼、润色交给 DeepSeek */
const TWO_VENDORS = { mode: "local", transcriber: "bailian/qwen3-asr-flash", polish: "deepseek" };

async function boot(t, { settings = TWO_VENDORS, stored = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), "speakmore-two-vendors-"));
  homes.push(home);
  const settingsFile = join(home, "settings.json");
  writeFileSync(settingsFile, JSON.stringify(settings));
  const route = routeOf(resolveSettings({ file: settingsFile, env: {} }));
  const keyStores = Object.fromEntries(VENDORS.map(({ id }) => [id, fakeStore(stored[id] ?? null)]));
  const installed = { isInstalled: () => true, status: () => ({ download: null }), remove() {} };
  const service = await startService({
    log: silent,
    route,
    modelsDir: home,
    models: installed,
    startLocal: async () => ({ backend: "cpu", transcribe: async () => ({ text: "" }), dispose() {} }),
  });
  // 测试没过也要关掉服务，不然进程退不出来
  t.after(() => service.close());
  let modes;
  const keys = createKeyManager({
    service,
    provider: keyVendorOf(route),
    keyStores,
    env: {},
    log: silent,
    onChange() {},
    routeFor: (id) => modes.routeForVendor(id),
  });
  modes = createModeSwitch({ service, keys, models: installed, settingsFile, env: {}, log: silent });
  return { service, keys, modes, keyStores };
}

test("给不在路线里的一家存 key：只验它自己，不拉上路线里第一跳那家（没带它的 key 时会被判成无效）", async (t) => {
  const app = await boot(t, { stored: { deepseek: "ds-good", bailian: "bl-good" } });
  await app.keys.loadAtStartup();
  requests.length = 0;
  const saved = await app.keys.save("kimi-good", { provider: "moonshot" });
  assert.deepEqual(saved, { ok: true });
  assert.equal(app.keyStores.moonshot.value, "kimi-good");
  assert.ok(
    requests.every(({ url }) => url.includes("moonshot")),
    JSON.stringify(requests),
  );
});

test("密钥表里检测一家、检测一个润色模型：只验那一家，路线里第一跳那家没有 key 也不受牵连", async (t) => {
  const app = await boot(t, { stored: { deepseek: "ds-good", moonshot: "kimi-good" } });
  const kimi = await app.modes.check("local", { polish: "moonshot" });
  assert.equal(kimi.ok, true, JSON.stringify(kimi));
});

test("第一跳那家的 key 失效：状态点名它；重填润色那家没用，给它存好 key 就接着用起来", async (t) => {
  const app = await boot(t, { stored: { deepseek: "ds-good", bailian: "bl-revoked" } });
  const started = await app.keys.loadAtStartup();
  assert.equal(started.state, "rejected");
  assert.deepEqual(started.vendor, { id: "bailian", name: "Bailian" });
  assert.match(zh.text(started.problem), /Bailian/);

  const again = await app.keys.save("ds-good");
  assert.equal(again.ok, false);
  assert.match(zh.text(again.problem), /Bailian/, "没通过的原因要点名真正出问题的那家");

  assert.deepEqual(await app.keys.save("bl-good", { provider: "bailian" }), { ok: true });
  assert.equal(app.keys.current.state, "ready");
  assert.equal(app.service.ready, true);
});

test("删掉第一跳那家的 key：听写的报错点名它、给的命令是它的", async (t) => {
  const app = await boot(t, { stored: { deepseek: "ds-good", bailian: "bl-good" } });
  await app.keys.loadAtStartup();
  await app.keys.forget({ provider: "bailian" });
  assert.deepEqual(app.keys.current.vendor, { id: "bailian", name: "Bailian" });
  const said = zh.text((await dictateOnce(app.service.url)).V.problem);
  assert.match(said, /Bailian/);
  assert.match(said, /speakmore key bailian/);
});

test("两把都删了、只把第一跳那家存回去：状态改说缺润色那家的", async (t) => {
  const app = await boot(t, { stored: { deepseek: "ds-good", bailian: "bl-good" } });
  await app.keys.loadAtStartup();
  await app.keys.forget({ provider: "deepseek" });
  await app.keys.forget({ provider: "bailian" });
  assert.deepEqual(await app.keys.save("bl-good", { provider: "bailian" }), { ok: true });
  assert.equal(app.keys.current.state, "missing");
  assert.equal(app.keys.current.vendor, undefined, "缺的是正在用的那家（DeepSeek），不再点名百炼");
});
