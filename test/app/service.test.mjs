import assert from "node:assert/strict";
import { test } from "node:test";
import { startService } from "../../src/app/service.mjs";
import { ModelError } from "../../src/server/providers/errors.mjs";

const quietLog = { info() {}, warn() {}, error() {} };
const OGG_CHUNK = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(60)]);

/** 按听写协议发一小段"录音"，返回服务端给的最后一条消息 */
function dictateOnce(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const audioId = crypto.randomUUID();
    socket.onerror = () => reject(new Error("连不上内置服务"));
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "start_audio", audio_id: audioId }));
      socket.send(
        JSON.stringify({ type: "set_audio_chunk_info", audio_id: audioId, index: 1, size: OGG_CHUNK.length }),
      );
      socket.send(OGG_CHUNK);
      socket.send(JSON.stringify({ type: "end_audio", audio_id: audioId }));
    };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.K === "audio_processing_completed" || message.K === "audio_processing_error") {
        socket.close();
        resolve(message);
      }
    };
  });
}

const fakeRefiner = (text, warmUp = async () => {}) => ({ warmUp, refine: async () => text });

// 模型层报上来的错都分好了类（src/server/providers/errors.mjs）
const UNAVAILABLE = () =>
  new ModelError({
    kind: "unavailable",
    problem: "Gemini 暂时用不了（The service is currently unavailable），过一会儿再试",
    detail: "503",
  });
const OFFLINE = () =>
  new ModelError({ kind: "unavailable", problem: "连不上 Gemini，检查网络后再试", detail: "fetch failed" });
const INVALID = () =>
  new ModelError({ kind: "key", problem: "这把 key 无效，检查有没有复制完整", detail: "API key not valid" });
const GEMINI = { provider: "gemini", model: "gemini-3.5-flash" };

test("没有 key 时服务照样在听，听写会失败并说明要去填 key", async (t) => {
  const service = await startService({ log: quietLog, model: GEMINI, createRefiner: () => fakeRefiner("不该用到") });
  t.after(() => service.close());
  assert.equal(service.ready, false);
  const reply = await dictateOnce(service.url);
  assert.equal(reply.K, "audio_processing_error");
  assert.match(reply.V.detail, /API key/);
});

test("换上能通过验证的 key 之后可以听写，地址不变", async (t) => {
  const seen = [];
  const service = await startService({
    log: quietLog,
    model: GEMINI,
    createRefiner: (options) => {
      seen.push(options.apiKey);
      return fakeRefiner("整理好的文字");
    },
  });
  t.after(() => service.close());
  const urlBefore = service.url;
  await service.useKey("key-1");
  assert.equal(service.ready, true);
  assert.equal(service.url, urlBefore);
  assert.deepEqual(seen, ["key-1"]);
  const reply = await dictateOnce(service.url);
  assert.equal(reply.K, "audio_processing_completed");
  assert.equal(reply.V.refined_text, "整理好的文字");
});

test("新 key 验证不过时报错，原来能用的那把继续用", async (t) => {
  const service = await startService({
    log: quietLog,
    model: GEMINI,
    createRefiner: ({ apiKey }) =>
      apiKey === "good"
        ? fakeRefiner("用的是好 key")
        : fakeRefiner("用的是坏 key", async () => {
            throw INVALID();
          }),
  });
  t.after(() => service.close());
  await service.useKey("good");
  await assert.rejects(service.useKey("bad"), /无效/);
  assert.equal(service.ready, true);
  assert.equal((await dictateOnce(service.url)).V.refined_text, "用的是好 key");
});

test("forgetKey 之后回到没有 key 的状态", async (t) => {
  const service = await startService({ log: quietLog, model: GEMINI, createRefiner: () => fakeRefiner("文字") });
  t.after(() => service.close());
  await service.useKey("key-1");
  service.forgetKey();
  assert.equal(service.ready, false);
  assert.equal((await dictateOnce(service.url)).K, "audio_processing_error");
});

test("启动时允许先用着：Gemini 回 503 时也一样，不把好 key 判成不能用", async (t) => {
  const busy = async () => {
    throw UNAVAILABLE();
  };
  const service = await startService({ log: quietLog, model: GEMINI, createRefiner: () => fakeRefiner("文字", busy) });
  t.after(() => service.close());
  assert.deepEqual(await service.useKey("stored-key", { allowUnverified: true }), { verified: false });
  assert.equal(service.ready, true);
});

test("启动时允许先用着：连不上 Gemini 时这把 key 照样启用，如实说还没验证", async (t) => {
  const offline = async () => {
    throw OFFLINE();
  };
  const service = await startService({
    log: quietLog,
    model: GEMINI,
    createRefiner: () => fakeRefiner("后来连上了", offline),
  });
  t.after(() => service.close());
  // 不说允许的话（用户刚填的新 key），连不上就是没通过
  await assert.rejects(service.useKey("stored-key"), /连不上/);
  assert.equal(service.ready, false);

  assert.deepEqual(await service.useKey("stored-key", { allowUnverified: true }), { verified: false });
  assert.equal(service.ready, true);
  assert.equal((await dictateOnce(service.url)).V.refined_text, "后来连上了");
});

test("允许先用着只管连不上的情况：key 无效照样拒绝", async (t) => {
  const invalid = async () => {
    throw INVALID();
  };
  const service = await startService({
    log: quietLog,
    model: GEMINI,
    createRefiner: () => fakeRefiner("不该用到", invalid),
  });
  t.after(() => service.close());
  await assert.rejects(service.useKey("bad", { allowUnverified: true }), /无效/);
  assert.equal(service.ready, false);
});

test("通过验证时说一声验证过了；verify 把正在用的那把再验一次", async (t) => {
  let online = false;
  const warmUp = async () => {
    if (!online) throw OFFLINE();
  };
  const service = await startService({
    log: quietLog,
    model: GEMINI,
    createRefiner: () => fakeRefiner("文字", warmUp),
  });
  t.after(() => service.close());
  await assert.rejects(service.verify(), /API key/);
  await service.useKey("k", { allowUnverified: true });
  await assert.rejects(service.verify(), /连不上/);
  online = true;
  await service.verify();
  assert.deepEqual(await service.useKey("k"), { verified: true });
});

test("没有 key 时的提示点名是哪一家：选的是 OpenAI 就说 OpenAI", async (t) => {
  const service = await startService({
    log: quietLog,
    model: { provider: "openai", model: "gpt-audio-mini" },
    createRefiner: () => fakeRefiner("不该用到"),
  });
  t.after(() => service.close());
  assert.match((await dictateOnce(service.url)).V.detail, /还没有填 OpenAI API key/);
});

test("按设置里选的厂商和模型装配；probe 拿另一把 key 试别的模型，不换掉正在用的；都带着同一个记账的", async (t) => {
  const built = [];
  const onModelCall = () => {};
  const service = await startService({
    log: quietLog,
    model: GEMINI,
    thinkingLevel: "LOW",
    onModelCall,
    createRefiner: async (options) => {
      built.push(options);
      return fakeRefiner(`用的是 ${options.choice.provider}`, async () => {
        if (options.apiKey === "bad") throw INVALID();
      });
    },
  });
  t.after(() => service.close());
  await service.useKey("gemini-key");
  assert.deepEqual(
    { choice: built[0].choice, apiKey: built[0].apiKey, thinkingLevel: built[0].thinkingLevel },
    { choice: GEMINI, apiKey: "gemini-key", thinkingLevel: "LOW" },
  );

  const openai = { provider: "openai", model: "gpt-audio-1.5" };
  await service.probe({ choice: openai, apiKey: "openai-key" });
  assert.deepEqual(built[1].choice, openai);
  assert.deepEqual(
    built.map(({ onCall }) => onCall),
    [onModelCall, onModelCall],
  );
  await assert.rejects(service.probe({ choice: openai, apiKey: "bad" }), /无效/);
  assert.equal((await dictateOnce(service.url)).V.refined_text, "用的是 gemini");
});

test("useKey 带上别的厂商和模型：验证过才整个换过去，没 key 时的提示也跟着换；没通过就还是原来的", async (t) => {
  const service = await startService({
    log: quietLog,
    model: GEMINI,
    createRefiner: async (options) =>
      fakeRefiner(`用的是 ${options.choice.provider}`, async () => {
        if (options.apiKey === "bad") throw INVALID();
      }),
  });
  t.after(() => service.close());
  await service.useKey("gemini-key");
  const openai = { provider: "openai", model: "gpt-audio-mini" };

  await assert.rejects(service.useKey("bad", { choice: openai }), /无效/);
  assert.deepEqual(service.model, GEMINI);
  assert.equal((await dictateOnce(service.url)).V.refined_text, "用的是 gemini");

  await service.useKey("openai-key", { choice: openai });
  assert.deepEqual(service.model, openai);
  assert.equal((await dictateOnce(service.url)).V.refined_text, "用的是 openai");
  service.forgetKey();
  assert.match((await dictateOnce(service.url)).V.detail, /还没有填 OpenAI API key/);
});
