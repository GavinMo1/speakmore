import assert from "node:assert/strict";
import { test } from "node:test";
import { startService } from "../../src/app/service.mjs";
import { createTranslator } from "../../src/i18n/index.mjs";
import { ModelError } from "../../src/server/providers/errors.mjs";

const zh = createTranslator("zh-CN");
/** 报错里给人看的那句，按中文翻出来对得上 */
const said = (pattern) => (error) => pattern.test(zh.text(error.problem ?? error.message));

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
const GEMINI = { mode: "native", model: { provider: "gemini", model: "gemini-3.5-flash" }, thinkingLevel: "LOW" };
const OPENAI = { mode: "native", model: { provider: "openai", model: "gpt-audio-mini" }, thinkingLevel: "LOW" };

test("没有 key 时服务照样在听，听写会失败并说明要去填 key", async (t) => {
  const service = await startService({ log: quietLog, route: GEMINI, createRefiner: () => fakeRefiner("不该用到") });
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
    route: GEMINI,
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
    route: GEMINI,
    createRefiner: ({ apiKey }) =>
      apiKey === "good"
        ? fakeRefiner("用的是好 key")
        : fakeRefiner("用的是坏 key", async () => {
            throw INVALID();
          }),
  });
  t.after(() => service.close());
  await service.useKey("good");
  await assert.rejects(service.useKey("bad"), said(/无效/));
  assert.equal(service.ready, true);
  assert.equal((await dictateOnce(service.url)).V.refined_text, "用的是好 key");
});

test("forgetKey 之后回到没有 key 的状态", async (t) => {
  const service = await startService({ log: quietLog, route: GEMINI, createRefiner: () => fakeRefiner("文字") });
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
  const service = await startService({ log: quietLog, route: GEMINI, createRefiner: () => fakeRefiner("文字", busy) });
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
    route: GEMINI,
    createRefiner: () => fakeRefiner("后来连上了", offline),
  });
  t.after(() => service.close());
  // 不说允许的话（用户刚填的新 key），连不上就是没通过
  await assert.rejects(service.useKey("stored-key"), said(/连不上/));
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
    route: GEMINI,
    createRefiner: () => fakeRefiner("不该用到", invalid),
  });
  t.after(() => service.close());
  await assert.rejects(service.useKey("bad", { allowUnverified: true }), said(/无效/));
  assert.equal(service.ready, false);
});

test("通过验证时说一声验证过了；verify 把正在用的那把再验一次", async (t) => {
  let online = false;
  const warmUp = async () => {
    if (!online) throw OFFLINE();
  };
  const service = await startService({
    log: quietLog,
    route: GEMINI,
    createRefiner: () => fakeRefiner("文字", warmUp),
  });
  t.after(() => service.close());
  await assert.rejects(service.verify(), said(/API key/));
  await service.useKey("k", { allowUnverified: true });
  await assert.rejects(service.verify(), said(/连不上/));
  online = true;
  await service.verify();
  assert.deepEqual(await service.useKey("k"), { verified: true });
});

test("没有 key 时的提示点名是哪一家：选的是 OpenAI 就说 OpenAI", async (t) => {
  const service = await startService({
    log: quietLog,
    route: OPENAI,
    createRefiner: () => fakeRefiner("不该用到"),
  });
  t.after(() => service.close());
  assert.match(zh.text((await dictateOnce(service.url)).V.problem), /还没有填 OpenAI API key/);
});

test("按设置里的路线装配；probe 拿另一把 key 试别的路线，不换掉正在用的；都带着同一个记账的", async (t) => {
  const built = [];
  const onModelCall = () => {};
  const service = await startService({
    log: quietLog,
    route: GEMINI,
    onModelCall,
    createRefiner: async (options) => {
      built.push(options);
      return fakeRefiner(`用的是 ${options.route.model.provider}`, async () => {
        if (options.apiKey === "bad") throw INVALID();
      });
    },
  });
  t.after(() => service.close());
  await service.useKey("gemini-key");
  assert.deepEqual({ route: built[0].route, apiKey: built[0].apiKey }, { route: GEMINI, apiKey: "gemini-key" });

  const openai = { ...OPENAI, model: { provider: "openai", model: "gpt-audio-1.5" } };
  await service.probe({ route: openai, apiKey: "openai-key" });
  assert.deepEqual(built[1].route, openai);
  assert.deepEqual(
    built.map(({ onCall }) => onCall),
    [onModelCall, onModelCall],
  );
  await assert.rejects(service.probe({ route: openai, apiKey: "bad" }), said(/无效/));
  assert.equal((await dictateOnce(service.url)).V.refined_text, "用的是 gemini");
});

test("useKey 带上别的路线：验证过才整个换过去，没 key 时的提示也跟着换；没通过就还是原来的", async (t) => {
  const service = await startService({
    log: quietLog,
    route: GEMINI,
    createRefiner: async (options) =>
      fakeRefiner(`用的是 ${options.route.model.provider}`, async () => {
        if (options.apiKey === "bad") throw INVALID();
      }),
  });
  t.after(() => service.close());
  await service.useKey("gemini-key");

  await assert.rejects(service.useKey("bad", { route: OPENAI }), said(/无效/));
  assert.deepEqual(service.route, GEMINI);
  assert.equal((await dictateOnce(service.url)).V.refined_text, "用的是 gemini");

  await service.useKey("openai-key", { route: OPENAI });
  assert.deepEqual(service.route, OPENAI);
  assert.equal((await dictateOnce(service.url)).V.refined_text, "用的是 openai");
  service.forgetKey();
  assert.match(zh.text((await dictateOnce(service.url)).V.problem), /还没有填 OpenAI API key/);
});

test("开口时的准备交给正在用的那一个；还没有 key 时什么都不做", async (t) => {
  let prepared = 0;
  const service = await startService({
    log: quietLog,
    route: GEMINI,
    createRefiner: () => ({ ...fakeRefiner("文字"), prepare: async () => void prepared++ }),
  });
  t.after(() => service.close());
  /** 开一次录音，等服务端回 audio_session_started */
  const startRecording = async () => {
    const socket = new WebSocket(service.url);
    await new Promise((resolve) => {
      socket.onopen = resolve;
    });
    socket.send(JSON.stringify({ type: "start_audio", audio_id: crypto.randomUUID() }));
    await new Promise((resolve) => {
      socket.onmessage = resolve;
    });
    socket.close();
  };
  await startRecording();
  assert.equal(prepared, 0);
  await service.useKey("gemini-key");
  await startRecording();
  assert.equal(prepared, 1);
});

const LOCAL = {
  mode: "local",
  transcriber: "qwen3-asr-0.6b-q8",
  polish: { vendor: "deepseek", model: "deepseek-flash" },
  customUrl: null,
};

/** 假的本地模型：手动控制下载进度和装好的时机，记下卸掉了几次 */
function fakeLocal() {
  const control = { started: [], disposed: 0 };
  const startLocal = (options) =>
    new Promise((resolve, reject) => {
      control.started.push(options.modelId);
      control.progress = (received, total) => options.onProgress({ received, total });
      control.finish = () =>
        resolve({
          backend: "fake",
          transcribe: async (samples) => ({ text: `转写了 ${samples.length}` }),
          dispose: () => control.disposed++,
        });
      control.fail = (error) => reject(error);
      options.signal.addEventListener("abort", () => reject(new Error("下载取消了")));
    });
  return { control, startLocal };
}

/** 假的 refiner：照路线把转写器用起来，好看出本地模型这一跳的状态 */
const throughTranscriber = async ({ transcriber }) => ({
  warmUp: async () => {},
  refine: async () => (await transcriber.transcribe(new Float32Array(3))).text,
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("本地转写链路：启动时就在后台准备模型；下载中、装载中按下热键会说清在干什么；装好了就能用", async (t) => {
  const { control, startLocal } = fakeLocal();
  let changes = 0;
  const service = await startService({
    log: quietLog,
    route: LOCAL,
    startLocal,
    createRefiner: throughTranscriber,
    onLocalModel: () => changes++,
  });
  t.after(() => service.close());
  assert.deepEqual(control.started, ["qwen3-asr-0.6b-q8"]);
  assert.equal(service.localModel.state, "loading");
  await service.useKey("deepseek-key");

  control.progress(50, 100);
  assert.deepEqual(service.localModel, { state: "downloading", model: "qwen3-asr-0.6b-q8", received: 50, total: 100 });
  assert.match(zh.text((await dictateOnce(service.url)).V.problem), /还在下载（50%）/);

  control.finish();
  await tick();
  assert.equal(service.localModel.state, "ready");
  assert.equal((await dictateOnce(service.url)).V.refined_text, "转写了 3");
  assert.ok(changes >= 3);
});

test("本地模型没装上：状态是失败，带着原因；按下热键时说的就是这个原因", async (t) => {
  const { control, startLocal } = fakeLocal();
  const service = await startService({ log: quietLog, route: LOCAL, startLocal, createRefiner: throughTranscriber });
  t.after(() => service.close());
  await service.useKey("deepseek-key");
  control.fail(new Error("哪个地址都没下下来"));
  await tick();
  assert.equal(service.localModel.state, "failed");
  assert.match(zh.text(service.localModel.problem), /本地模型没装上：哪个地址都没下下来/);
  assert.match(zh.text((await dictateOnce(service.url)).V.problem), /本地模型没装上/);
});

test("改走原生链路：本地模型卸掉，内存还回去；再换回来重新装", async (t) => {
  const { control, startLocal } = fakeLocal();
  const service = await startService({ log: quietLog, route: LOCAL, startLocal, createRefiner: throughTranscriber });
  t.after(() => service.close());
  control.finish();
  await tick();
  assert.equal(service.localModel.state, "ready");

  await service.useKey("gemini-key", { route: GEMINI });
  assert.equal(control.disposed, 1);
  assert.deepEqual(service.localModel, { state: "off" });

  await service.useKey("deepseek-key", { route: LOCAL });
  assert.deepEqual(control.started, ["qwen3-asr-0.6b-q8", "qwen3-asr-0.6b-q8"]);
});

test("换 key、换润色的那家不动本地模型；换本地模型才重装，没下完的那次停掉", async (t) => {
  const { control, startLocal } = fakeLocal();
  const service = await startService({ log: quietLog, route: LOCAL, startLocal, createRefiner: throughTranscriber });
  t.after(() => service.close());
  await service.useKey("key-1");
  await service.useKey("key-2", {
    route: { ...LOCAL, polish: { vendor: "custom", model: "m" }, customUrl: "http://x/v1" },
  });
  assert.deepEqual(control.started, ["qwen3-asr-0.6b-q8"]);

  await service.useKey("key-2", { route: { ...LOCAL, transcriber: "sensevoice-small-q8" } });
  assert.deepEqual(control.started, ["qwen3-asr-0.6b-q8", "sensevoice-small-q8"]);
  assert.equal(service.localModel.model, "sensevoice-small-q8");
});

test("local 的第一跳单独换：只换本地模型，不重新验证润色的那家、不动 key；不在 local 模式时不让换", async (t) => {
  const { control, startLocal } = fakeLocal();
  let built = 0;
  const createRefiner = async (options) => {
    built++;
    return throughTranscriber(options);
  };
  const service = await startService({ log: quietLog, route: LOCAL, startLocal, createRefiner });
  t.after(() => service.close());
  await service.useKey("ds-key");
  assert.equal(built, 1);

  service.switchTranscriber("sensevoice-small-q8");
  assert.equal(built, 1);
  assert.equal(service.ready, true);
  assert.equal(service.route.transcriber, "sensevoice-small-q8");
  assert.deepEqual(service.route.polish, LOCAL.polish);
  assert.deepEqual(control.started, ["qwen3-asr-0.6b-q8", "sensevoice-small-q8"]);

  const native = await startService({ log: quietLog, route: GEMINI, createRefiner: async () => fakeRefiner("x") });
  t.after(() => native.close());
  assert.throws(() => native.switchTranscriber("sensevoice-small-q8"), /local/);
});

test("本地模型没装上时再选同一个：重新下载、装载（重试的办法）；装好了再选同一个不重装", async (t) => {
  const { control, startLocal } = fakeLocal();
  const service = await startService({ log: quietLog, route: LOCAL, startLocal, createRefiner: throughTranscriber });
  t.after(() => service.close());
  control.fail(new Error("哪个地址都没下下来"));
  await tick();
  assert.equal(service.localModel.state, "failed");

  service.switchTranscriber("qwen3-asr-0.6b-q8");
  assert.deepEqual(control.started, ["qwen3-asr-0.6b-q8", "qwen3-asr-0.6b-q8"]);
  control.finish();
  await tick();
  assert.equal(service.localModel.state, "ready");
  service.switchTranscriber("qwen3-asr-0.6b-q8");
  assert.equal(control.started.length, 2);
});
