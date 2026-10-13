import assert from "node:assert/strict";
import { test } from "node:test";
import { describeKeyError, startService } from "../../src/app/service.mjs";

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

/** 和 SDK 抛的一样：message 是 Gemini 回的整段 JSON，status 是 HTTP 状态码 */
function apiError(code, message, status) {
  return Object.assign(new Error(JSON.stringify({ error: { code, message, status } })), {
    name: "ApiError",
    status: code,
  });
}

test("没有 key 时服务照样在听，听写会失败并说明要去填 key", async (t) => {
  const service = await startService({ log: quietLog, createRefiner: () => fakeRefiner("不该用到") });
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
    createRefiner: ({ apiKey }) =>
      apiKey === "good"
        ? fakeRefiner("用的是好 key")
        : fakeRefiner("用的是坏 key", async () => {
            throw new Error("API key not valid");
          }),
  });
  t.after(() => service.close());
  await service.useKey("good");
  await assert.rejects(service.useKey("bad"), /API key not valid/);
  assert.equal(service.ready, true);
  assert.equal((await dictateOnce(service.url)).V.refined_text, "用的是好 key");
});

test("forgetKey 之后回到没有 key 的状态", async (t) => {
  const service = await startService({ log: quietLog, createRefiner: () => fakeRefiner("文字") });
  t.after(() => service.close());
  await service.useKey("key-1");
  service.forgetKey();
  assert.equal(service.ready, false);
  assert.equal((await dictateOnce(service.url)).K, "audio_processing_error");
});

test("启动时允许先用着：Gemini 回 503 时也一样，不把好 key 判成不能用", async (t) => {
  const busy = async () => {
    throw apiError(503, "The service is currently unavailable.", "UNAVAILABLE");
  };
  const service = await startService({ log: quietLog, createRefiner: () => fakeRefiner("文字", busy) });
  t.after(() => service.close());
  assert.deepEqual(await service.useKey("stored-key", { allowUnverified: true }), { verified: false });
  assert.equal(service.ready, true);
});

test("启动时允许先用着：连不上 Gemini 时这把 key 照样启用，如实说还没验证", async (t) => {
  const offline = async () => {
    throw new TypeError("fetch failed");
  };
  const service = await startService({ log: quietLog, createRefiner: () => fakeRefiner("后来连上了", offline) });
  t.after(() => service.close());
  // 不说允许的话（用户刚填的新 key），连不上就是没通过
  await assert.rejects(service.useKey("stored-key"), /fetch failed/);
  assert.equal(service.ready, false);

  assert.deepEqual(await service.useKey("stored-key", { allowUnverified: true }), { verified: false });
  assert.equal(service.ready, true);
  assert.equal((await dictateOnce(service.url)).V.refined_text, "后来连上了");
});

test("允许先用着只管连不上的情况：key 无效照样拒绝", async (t) => {
  const invalid = async () => {
    throw new Error("API key not valid");
  };
  const service = await startService({ log: quietLog, createRefiner: () => fakeRefiner("不该用到", invalid) });
  t.after(() => service.close());
  await assert.rejects(service.useKey("bad", { allowUnverified: true }), /API key not valid/);
  assert.equal(service.ready, false);
});

test("通过验证时说一声验证过了；verify 把正在用的那把再验一次", async (t) => {
  let online = false;
  const warmUp = async () => {
    if (!online) throw new TypeError("fetch failed");
  };
  const service = await startService({ log: quietLog, createRefiner: () => fakeRefiner("文字", warmUp) });
  t.after(() => service.close());
  await assert.rejects(service.verify(), /API key/);
  await service.useKey("k", { allowUnverified: true });
  await assert.rejects(service.verify(), /fetch failed/);
  online = true;
  await service.verify();
  assert.deepEqual(await service.useKey("k"), { verified: true });
});

test("key 验证失败的原因分三种：key 不对、暂时够不着 Gemini、Gemini 拒绝了请求", () => {
  // 这里的报错都是实测到的：假 key、1 毫秒超时、写错的模型名、Gemini 偶尔回的 503
  const invalid = new Error(
    '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}',
  );
  assert.deepEqual(
    { cause: describeKeyError(invalid).cause, problem: describeKeyError(invalid).problem },
    { cause: "key", problem: "这把 key 无效，检查有没有复制完整" },
  );

  const aborted = new DOMException("This operation was aborted", "AbortError");
  assert.equal(describeKeyError(aborted).cause, "unavailable");
  assert.match(describeKeyError(aborted).problem, /连不上/);
  assert.equal(describeKeyError(new TypeError("fetch failed")).cause, "unavailable");

  // Gemini 自己出了状况或者限流：和 key、和设置都没关系，过一会儿就好
  const busy = describeKeyError(apiError(503, "The service is currently unavailable.", "UNAVAILABLE"));
  assert.equal(busy.cause, "unavailable");
  assert.equal(busy.problem, "Gemini 暂时用不了（The service is currently unavailable），过一会儿再试");
  assert.equal(describeKeyError(apiError(500, "Internal error.", "INTERNAL")).cause, "unavailable");
  assert.equal(describeKeyError(apiError(429, "Resource exhausted.", "RESOURCE_EXHAUSTED")).cause, "unavailable");

  const other = describeKeyError(
    apiError(
      404,
      "models/gemini-no-such-model is not found for API version v1beta, or is not supported for generateContent.",
      "NOT_FOUND",
    ),
  );
  assert.equal(other.cause, "other");
  // 只把 Gemini 说的那句话带给用户，不带整段 JSON；句尾的句号去掉，后面还要接别的话
  assert.match(other.problem, /^Gemini 拒绝了请求：models\/gemini-no-such-model is not found.*generateContent$/);
  assert.doesNotMatch(other.problem, /"code"/);

  const long = describeKeyError(new Error("x".repeat(500)));
  assert.equal(long.cause, "other");
  assert.ok(long.problem.length <= 200);
});

test("报错里带着 key 本身时先抹掉：给用户看的话和留给日志的原文里都没有它", () => {
  // 实测：带换行的 key 交给 SDK，报的就是这一句，引号里是整段输入
  const key = "line-one-SECRET\nline-two-SECRET";
  const leaked = new TypeError(`Headers.append: "${key}" is an invalid header value.`);
  const described = describeKeyError(leaked, key);
  assert.doesNotMatch(described.problem + described.detail, /SECRET/);
  assert.match(described.detail, /invalid header value/);
});
