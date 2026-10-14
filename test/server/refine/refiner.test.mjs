import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelError } from "../../../src/server/providers/errors.mjs";
import { NO_SPEECH_MARK, SYSTEM_PROMPT, TASK_REMINDER } from "../../../src/server/refine/prompt.mjs";
import {
  createModelRefiner,
  createRefiner,
  generateClean,
  textFromModelOutput,
} from "../../../src/server/refine/refiner.mjs";

test("提示词里写的无人声标记，和代码里判断的是同一个", () => {
  assert.ok(SYSTEM_PROMPT.includes(`只输出 ${NO_SPEECH_MARK}，`));
});

test("模型输出无人声标记或什么都没输出时，成品是空字符串", () => {
  assert.equal(textFromModelOutput(NO_SPEECH_MARK), "");
  assert.equal(textFromModelOutput(` ${NO_SPEECH_MARK}\n`), "");
  assert.equal(textFromModelOutput(undefined), "");
  assert.equal(textFromModelOutput("  "), "");
});

test("首尾空白去掉；用户真的说到了这个标记时不误删", () => {
  assert.equal(textFromModelOutput(" 我们后天开会吗？\n"), "我们后天开会吗？");
  assert.equal(textFromModelOutput(`标记是 ${NO_SPEECH_MARK} 这几个字`), `标记是 ${NO_SPEECH_MARK} 这几个字`);
});

test("整段成品最后的那个句号去掉；中间的句号、结尾的问号叹号省略号都留着", () => {
  assert.equal(textFromModelOutput("我们后天开会。"), "我们后天开会");
  assert.equal(textFromModelOutput("先这样。\n\n明天再对一下。\n"), "先这样。\n\n明天再对一下");
  assert.equal(textFromModelOutput("你觉得可以吗？"), "你觉得可以吗？");
  assert.equal(textFromModelOutput("开干吧！"), "开干吧！");
  assert.equal(textFromModelOutput("等等……"), "等等……");
});

test("模型偶尔写出的繁体字换成简体，本来就是简体的字词和英文数字不动", () => {
  assert.equal(textFromModelOutput("降低成本的這個事，後面再說"), "降低成本的这个事，后面再说");
  assert.equal(textFromModelOutput("著名的乾坤大挪移，用 workflow 1.5.0"), "著名的乾坤大挪移，用 workflow 1.5.0");
});

test("模型在成品前面多吐的一个外文词去掉：紧贴着汉字的，或者单独占一行的", () => {
  assert.equal(textFromModelOutput("me我有个疑惑"), "我有个疑惑");
  assert.equal(textFromModelOutput("the.要写一个教程"), "要写一个教程");
  assert.equal(textFromModelOutput("get_prompt\n对，开干！"), "对，开干！");
  assert.equal(textFromModelOutput("any\n\n还有一个事"), "还有一个事");
  assert.equal(textFromModelOutput("особен没问题"), "没问题");
});

test("他真的以英文开头的话不动：英文后面是空格或标点", () => {
  for (const text of ["UI 这块再调一下", "OK，那就这样", "Minecraft 里怎么把 PVP 打开？", "README", "LGTM!"]) {
    assert.equal(textFromModelOutput(text), text);
  }
});

function fakeGenerate(outputs) {
  const calls = { count: 0, warnings: [] };
  const generateOnce = async () => outputs[calls.count++];
  const log = { warn: (event, fields) => calls.warnings.push({ event, ...fields }) };
  return { calls, generateOnce, log };
}

test("成品里夹着时间戳时重来一次，用第二次的结果，并记一条日志", async () => {
  const { calls, generateOnce, log } = fakeGenerate(["全面开干、 00:30 全面迁移", "全面开干、全面迁移"]);
  assert.equal(await generateClean(generateOnce, log), "全面开干、全面迁移");
  assert.equal(calls.count, 2);
  assert.deepEqual(calls.warnings, [{ event: "refine_retry", reason: "成品里夹着时间戳" }]);
});

test("成品正常时只调一次；版本号和比例不算时间戳", async () => {
  const { calls, generateOnce, log } = fakeGenerate(["版本 1.5.0，比例 3:1，一共 12 条"]);
  assert.equal(await generateClean(generateOnce, log), "版本 1.5.0，比例 3:1，一共 12 条");
  assert.equal(calls.count, 1);
  assert.deepEqual(calls.warnings, []);
});

test("重来一次还有钟点，就当是他真说了，不再重试", async () => {
  const { calls, generateOnce, log } = fakeGenerate(["明天 09:30 开会", "明天 09:30 开会"]);
  assert.equal(await generateClean(generateOnce, log), "明天 09:30 开会");
  assert.equal(calls.count, 2);
});

// ---------- 共用的整理流程：各家的适配器只管"发请求、拿原文"，其余在这里 ----------

/** 假的适配器：记下每次 generate 收到了什么，按顺序吐出给定的原文 */
function fakeClient(outputs, { ping = async () => {} } = {}) {
  const calls = [];
  return {
    calls,
    ping,
    async generate(request) {
      calls.push(request);
      const next = outputs[calls.length - 1];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const quietLog = { info() {}, warn() {}, error() {} };
const OpenAI = { id: "openai", name: "OpenAI" };

function refinerWith(client, options = {}) {
  const transcoded = [];
  const refiner = createRefiner({
    provider: OpenAI,
    client,
    audioTypes: ["audio/wav"],
    log: quietLog,
    timeoutMs: 1_000,
    transcode: async (audio, mimeType) => {
      transcoded.push(mimeType);
      return { audio: Buffer.from(`wav:${audio}`), mimeType: "audio/wav" };
    },
    ...options,
  });
  return { refiner, transcoded };
}

test("交给模型的是同一份提示词和同一句提醒，成品照样经过收尾（繁转简、去句末句号）", async () => {
  const client = fakeClient(["我們後天開會。"]);
  const { refiner } = refinerWith(client, { audioTypes: ["audio/webm"] });
  assert.equal(await refiner.refine(Buffer.from("rec"), { mimeType: "audio/webm" }), "我们后天开会");
  const [request] = client.calls;
  assert.equal(request.systemPrompt, SYSTEM_PROMPT);
  assert.equal(request.reminder, TASK_REMINDER);
  assert.equal(request.mimeType, "audio/webm");
  assert.equal(String(request.audio), "rec");
});

test("这家不收录音的格式时先换好再交过去；夹着时间戳要重来时也只换一次", async () => {
  const client = fakeClient(["全面开干、 00:30 全面迁移", "全面开干、全面迁移"]);
  const { refiner, transcoded } = refinerWith(client);
  assert.equal(await refiner.refine(Buffer.from("rec"), { mimeType: "audio/webm" }), "全面开干、全面迁移");
  assert.deepEqual(transcoded, ["audio/webm"]);
  assert.deepEqual(
    client.calls.map(({ audio, mimeType }) => [String(audio), mimeType]),
    [
      ["wav:rec", "audio/wav"],
      ["wav:rec", "audio/wav"],
    ],
  );
});

test("客户端断开时取消请求：交给适配器的 signal 跟着断", async () => {
  let seen;
  const client = fakeClient([]);
  client.generate = (request) => {
    seen = request.signal;
    return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason)));
  };
  const { refiner } = refinerWith(client, { audioTypes: ["audio/webm"] });
  const abort = new AbortController();
  const pending = refiner.refine(Buffer.from("rec"), { mimeType: "audio/webm", signal: abort.signal });
  abort.abort();
  await assert.rejects(pending);
  assert.equal(seen.aborted, true);
});

test("出错时报的是分好类的 ModelError：说得出是哪一家、该怎么办", async () => {
  const offline = new TypeError("fetch failed");
  const { refiner } = refinerWith(fakeClient([offline]), { audioTypes: ["audio/webm"] });
  const error = await refiner.refine(Buffer.from("rec"), { mimeType: "audio/webm" }).catch((thrown) => thrown);
  assert.ok(error instanceof ModelError);
  assert.equal(error.kind, "unavailable");
  assert.equal(error.message, "连不上 OpenAI，检查网络后再试");
});

test("录音换不了格式时也报 ModelError，不让原始的解码错误直接冒出去", async () => {
  const { refiner } = refinerWith(fakeClient([]), {
    transcode: async () => {
      throw new Error("录音解不出声音（audio/webm）：坏了");
    },
  });
  const error = await refiner.refine(Buffer.from("rec"), { mimeType: "audio/webm" }).catch((thrown) => thrown);
  assert.ok(error instanceof ModelError);
  assert.match(error.message, /解不出声音/);
});

test("warmUp 发适配器的最小请求；失败时同样分好类", async () => {
  let pinged = 0;
  const { refiner } = refinerWith(fakeClient([], { ping: async () => void pinged++ }));
  await refiner.warmUp();
  assert.equal(pinged, 1);

  const invalid = Object.assign(new Error("401"), { status: 401 });
  const { refiner: failing } = refinerWith(
    fakeClient([], {
      ping: async () => {
        throw invalid;
      },
    }),
    { classify: (error) => (error.status === 401 ? { kind: "key", problem: "这把 key 无效" } : null) },
  );
  const error = await failing.warmUp().catch((thrown) => thrown);
  assert.deepEqual([error.kind, error.message], ["key", "这把 key 无效"]);
});

test("createModelRefiner：按选的厂商装上对应的适配器；不认识的厂商直接报错", async () => {
  const refiner = await createModelRefiner({
    choice: { provider: "openai", model: "gpt-audio-mini" },
    apiKey: "k",
    log: quietLog,
  });
  assert.equal(typeof refiner.refine, "function");
  assert.equal(typeof refiner.warmUp, "function");
  await assert.rejects(
    createModelRefiner({ choice: { provider: "deepseek", model: "x" }, apiKey: "k", log: quietLog }),
    /deepseek/,
  );
});
