import assert from "node:assert/strict";
import { test } from "node:test";
import { withOllamaIdleRelease } from "../../../src/server/refine/ollama-memory.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture(t, overrides = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const errors = [];
  const client = withOllamaIdleRelease({
    client: {
      async ping() {
        return "ping";
      },
      async complete() {
        return "text";
      },
    },
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "example:1b",
    apiKey: "test",
    log: {
      info() {},
      error(event) {
        errors.push(event);
      },
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json(url.endsWith("/api/version") ? { version: "0.13.0" } : { done: true });
    },
    ...overrides,
  });
  t.after(() => client.dispose());
  return { client, calls, errors };
}

test("Ollama 在最后一次调用结束五分钟后释放，下次调用仍然正常", async (t) => {
  const { client, calls } = fixture(t);
  assert.equal(await client.ping({}), "ping");
  t.mock.timers.tick(299_999);
  assert.equal(calls.length, 2);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(calls[2].url, "http://127.0.0.1:11434/api/generate");
  assert.deepEqual(JSON.parse(calls[2].options.body), { model: "example:1b", keep_alive: 0, stream: false });
  assert.equal(await client.complete({}), "text");
});

test("请求进行中不卸载，并发全部结束后重新计时", async (t) => {
  const pending = [];
  const { client, calls } = fixture(t, { client: { complete: () => new Promise((resolve) => pending.push(resolve)) } });
  const first = client.complete({});
  const second = client.complete({});
  await settle();
  pending.shift()("a");
  await first;
  t.mock.timers.tick(300_000);
  await settle();
  assert.equal(calls.length, 2);
  pending.shift()("b");
  await second;
  t.mock.timers.tick(300_000);
  await settle();
  assert.equal(calls.length, 4);
});

test("不向远程地址或非 Ollama 服务发送释放请求", async (t) => {
  const { client, calls } = fixture(t, { baseUrl: "https://example.com/v1" });
  await assert.rejects(client.ping({}), (error) => error.problem?.key === "chat.memoryUnsupported");
  assert.equal(calls.length, 0);
});

test("兼容接口不是 Ollama 时明确失败，不尝试卸载", async (t) => {
  const { client } = fixture(t, { fetch: async () => Response.json({ object: "list" }) });
  await assert.rejects(client.ping({}), (error) => error.problem?.key === "chat.memoryUnsupported");
});

test("释放失败写日志，不影响下一次润色", async (t) => {
  const { client, errors } = fixture(t, {
    fetch: async (url, options) =>
      url.endsWith("/api/version")
        ? Response.json({ version: "0.13.0" })
        : JSON.parse(options.body).keep_alive === 0
          ? new Response("", { status: 500 })
          : Response.json({ done: true }),
  });
  await client.ping({});
  t.mock.timers.tick(300_000);
  await settle();
  assert.deepEqual(errors, ["ollama_idle_release_failed"]);
  assert.equal(await client.complete({}), "text");
});

test("dispose 取消计时，未结束请求也不会重新安排卸载", async (t) => {
  let finish;
  const { client, calls } = fixture(t, {
    client: {
      complete: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  const pending = client.complete({});
  await settle();
  client.dispose();
  finish("done");
  await pending;
  t.mock.timers.tick(300_000);
  await settle();
  assert.equal(calls.length, 1);
});

test("卸载已经发出时，新请求等卸载结束后再使用模型", async (t) => {
  let finishUnload;
  let completes = 0;
  const { client } = fixture(t, {
    client: {
      async ping() {},
      async complete() {
        completes++;
      },
    },
    fetch: async (url, options) =>
      url.endsWith("/api/version")
        ? Response.json({ version: "0.13.0" })
        : JSON.parse(options.body).keep_alive !== 0
          ? Response.json({ done: true })
          : new Promise((resolve) => {
              finishUnload = () => resolve(Response.json({ done: true }));
            }),
  });
  await client.ping({});
  t.mock.timers.tick(300_000);
  await settle();
  const next = client.complete({});
  await settle();
  assert.equal(completes, 0);
  finishUnload();
  await next;
  assert.equal(completes, 1);
});

test("润色报错后也安排释放，取消计时的 dispose 不发额外请求", async (t) => {
  const { client, calls } = fixture(t, {
    client: {
      async complete() {
        throw new Error("failed");
      },
    },
  });
  await assert.rejects(client.complete({}), /failed/);
  client.dispose();
  t.mock.timers.tick(300_000);
  await settle();
  assert.equal(calls.length, 1);
});

for (const idleMinutes of ["1", "10"]) {
  test(`Ollama 按所选 ${idleMinutes} 分钟释放，下一次使用重新计时`, async (t) => {
    const { client, calls } = fixture(t, { idleMinutes });
    await client.ping({});
    t.mock.timers.tick(Number(idleMinutes) * 60_000 - 1);
    await settle();
    assert.equal(calls.length, 2);
    t.mock.timers.tick(1);
    await settle();
    assert.equal(calls.length, 3);
    await client.complete({});
    t.mock.timers.tick(Number(idleMinutes) * 60_000);
    await settle();
    assert.equal(calls.length, 5);
  });
}

test("成功调用后将所选时长交给 Ollama，覆盖其默认五分钟而不改全局", async (t) => {
  const { client, calls } = fixture(t, { idleMinutes: "30" });
  assert.equal(await client.complete({}), "text");
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), { model: "example:1b", keep_alive: "30m", stream: false });
});

test("刷新驻留失败记录日志，已成功的文字照常返回且仍尝试空闲释放", async (t) => {
  const { client, errors } = fixture(t, {
    fetch: async (url, options) =>
      url.endsWith("/api/version")
        ? Response.json({ version: "0.33.2" })
        : JSON.parse(options.body).keep_alive === 0
          ? Response.json({ done: true })
          : new Response("", { status: 500 }),
  });
  assert.equal(await client.complete({}), "text");
  assert.deepEqual(errors, ["ollama_idle_retention_failed"]);
  t.mock.timers.tick(300_000);
  await settle();
  assert.deepEqual(errors, ["ollama_idle_retention_failed"]);
});

test("Ollama 暂时不可用保留网络错误，恢复后重新验证", async (t) => {
  let attempts = 0;
  const unavailable = new TypeError("fetch failed");
  const { client } = fixture(t, {
    fetch: async (url) => {
      if (!url.endsWith("/api/version")) return Response.json({ done: true });
      if (++attempts === 1) throw unavailable;
      return Response.json({ version: "0.13.0" });
    },
  });
  await assert.rejects(client.complete({}), (error) => error === unavailable);
  assert.equal(await client.complete({}), "text");
  assert.equal(attempts, 2);
});
