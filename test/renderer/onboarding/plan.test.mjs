import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changesOf,
  hasKey,
  inEffect,
  localModelOf,
  needsOf,
  planOf,
  readinessOf,
  vendorsFor,
} from "../../../src/renderer/onboarding/plan.mjs";

const QWEN = "qwen3-asr-0.6b-q8";
const SENSEVOICE = "sensevoice-small-int8";

/**
 * 主进程按设置算好的每种方式（app/model-plaza.mjs 的 ways）：一路经过谁、差什么。
 * 这里照它的规矩写个简化的：本机模型没下好、要的那家没有 key（sources 里没有）
 */
function waysOf({ native, transcriber, privateTranscriber, polish, installed, sources }) {
  const first = (id) =>
    id.includes("/") ? { platform: id.split("/")[0], maker: "qwen", name: id } : { platform: "local" };
  const way = (mode) => {
    const local = mode === "native" ? null : mode === "private" ? privateTranscriber : transcriber;
    const vendor = mode === "native" ? native.split("/")[0] : mode === "local" ? polish.split("/")[0] : null;
    const needs = [];
    if (local && !local.includes("/") && !installed.includes(local)) needs.push({ kind: "download", model: local });
    if (local?.includes("/") && !sources[local.split("/")[0]])
      needs.push({ kind: "key", platform: local.split("/")[0] });
    if (vendor && vendor !== "custom" && !sources[vendor]) needs.push({ kind: "key", platform: vendor });
    return { hops: local ? [first(local)] : [], needs };
  };
  return { native: way("native"), local: way("local"), private: way("private") };
}

/** getSetup 里引导用得到的那几样：第一次打开时的样子，原生、Gemini、没有 key、什么都没下 */
function setup({
  mode = "native",
  native = "gemini/gemini-3.6-flash",
  transcriber = QWEN,
  privateTranscriber = QWEN,
  polish = "deepseek/deepseek-flash",
  installed = [],
  downloading = [],
  keys = {},
  provider = "gemini",
  key = "missing",
  localModel = null,
  presets = [
    { mode: "local", settings: { transcriber: QWEN, polish: "deepseek/deepseek-flash" } },
    { mode: "native", settings: { model: "gemini/gemini-3.6-flash" } },
    { mode: "local", settings: { transcriber: "bailian/qwen3-asr-flash", polish: "bailian/deepseek-v4.1-flash" } },
    { mode: "private", settings: { privateTranscriber: QWEN } },
  ],
} = {}) {
  const vendor = (id) => ({ id, key: keys[id] ?? null });
  // 服务正拿着那家的 key（准备好了、在验、被拒、读不出）：那家算存着
  const holding = provider && key !== "missing" ? { [provider]: "stored" } : {};
  const sources = { ...keys, ...holding };
  return {
    mode: { value: mode },
    native: { model: native, providers: ["gemini", "openai", "bailian"].map(vendor) },
    local: {
      transcriber,
      polish,
      transcribers: [QWEN, SENSEVOICE].map((id) => ({
        id,
        installed: installed.includes(id),
        download: downloading.includes(id) ? { received: 1, total: 10 } : null,
      })),
      vendors: ["deepseek", "bailian", "moonshot", "zhipu", "minimax", "custom"].map(vendor),
    },
    private: { transcriber: privateTranscriber },
    plaza: { presets, ways: waysOf({ native, transcriber, privateTranscriber, polish, installed, sources }) },
    provider: provider ? { id: provider } : null,
    key: { state: key, problem: key === "rejected" ? "这把 key 无效" : null },
    localModel,
  };
}

test("能挑的几家：原生是收音频的三家；转写 + 润色是润色的几家，自定义服务留给模型页", () => {
  assert.deepEqual(
    vendorsFor(setup(), "native").map(({ id }) => id),
    ["gemini", "openai", "bailian"],
  );
  assert.deepEqual(
    vendorsFor(setup(), "local").map(({ id }) => id),
    ["deepseek", "bailian", "moonshot", "zhipu", "minimax"],
  );
  assert.deepEqual(vendorsFor(setup(), "private"), []);
});

test("打算照现在的设置（点了就当场换上）；润色是自定义服务时照实是 custom", () => {
  assert.deepEqual(planOf(setup()), { mode: "native", native: "gemini", polish: "deepseek" });
  assert.deepEqual(planOf(setup({ mode: "local", native: "openai", polish: "moonshot/kimi-k2" })), {
    mode: "local",
    native: "openai",
    polish: "moonshot",
  });
  assert.equal(planOf(setup({ polish: "custom/qwen3-8b" })).polish, "custom");
});

test("本机模型：设置里的下好了就用它，没下好用这台机器推荐组合里的", () => {
  assert.equal(localModelOf(setup({ privateTranscriber: SENSEVOICE, installed: [SENSEVOICE] }), "private"), SENSEVOICE);
  // Intel Mac 的推荐是 SenseVoice：设置里的 Qwen 没下好，就推它
  const intel = [{ mode: "private", settings: { privateTranscriber: SENSEVOICE } }];
  assert.equal(localModelOf(setup({ presets: intel }), "private"), SENSEVOICE);
  // 转写 + 润色的推荐组合里第一跳是云端的那个不算
  const cloudFirst = [{ mode: "local", settings: { transcriber: "bailian/qwen3-asr-flash" } }];
  assert.equal(localModelOf(setup({ presets: cloudFirst, transcriber: SENSEVOICE }), "local"), SENSEVOICE);
  // 设置里是云端转写、也没有推荐：用清单里的第一个
  assert.equal(localModelOf(setup({ presets: [], transcriber: "bailian/qwen3-asr-flash" }), "local"), QWEN);
  // 正在用的那种方式：就是设置里那个，还没下好也照实说，不换成推荐的
  assert.equal(
    localModelOf(setup({ mode: "private", privateTranscriber: SENSEVOICE, presets: intel }), "private"),
    SENSEVOICE,
  );
  assert.equal(localModelOf(setup({ mode: "private", privateTranscriber: SENSEVOICE }), "private"), SENSEVOICE);
});

test("有没有 key：服务正拿着的那家看那把 key 的状态，别家看存没存", () => {
  assert.equal(hasKey(setup({ key: "ready" }), "native", "gemini"), true);
  assert.equal(hasKey(setup({ key: "checking" }), "native", "gemini"), true);
  // 存了但被拒了：算没有
  assert.equal(hasKey(setup({ key: "rejected", keys: { gemini: "stored" } }), "native", "gemini"), false);
  assert.equal(hasKey(setup({ keys: { openai: "env" } }), "native", "openai"), true);
  assert.equal(hasKey(setup({ keys: { moonshot: "stored" } }), "local", "moonshot"), true);
  assert.equal(hasKey(setup(), "local", "moonshot"), false);
});

test("还差什么：照主进程算好的；原生只差 key，转写 + 润色差下载和 key，数据隐私只差下载", () => {
  const plan = (mode, extra = {}) => ({ mode, native: "gemini", polish: "deepseek", ...extra });
  assert.deepEqual(needsOf(plan("native"), setup()), [{ kind: "key", vendor: "gemini" }]);
  assert.deepEqual(needsOf(plan("native"), setup({ key: "ready" })), []);
  assert.deepEqual(needsOf(plan("local"), setup({ polish: "zhipu/glm-4.7" })), [
    { kind: "download", model: QWEN, downloading: false },
    { kind: "key", vendor: "zhipu" },
  ]);
  // 正在用的那家 key 存着却没通过：主进程只看有没有，这里补上
  assert.deepEqual(needsOf(plan("native"), setup({ key: "rejected" })), [{ kind: "key", vendor: "gemini" }]);
  // 模型页配的搭法照实算：第一跳交给云端（有它的 key）不用下本机模型，自定义服务不要 key
  const cloud = setup({
    mode: "local",
    provider: "deepseek",
    key: "ready",
    transcriber: "bailian/qwen3-asr-flash",
    keys: { bailian: "stored" },
  });
  assert.deepEqual(needsOf(plan("local"), cloud), []);
  const custom = setup({
    mode: "local",
    provider: "custom",
    key: "ready",
    polish: "custom/qwen3:8b",
    installed: [QWEN],
  });
  assert.deepEqual(needsOf(planOf(custom), custom), []);
  assert.deepEqual(needsOf(plan("private"), setup({ downloading: [QWEN] })), [
    { kind: "download", model: QWEN, downloading: true },
  ]);
  assert.deepEqual(needsOf(plan("private"), setup({ installed: [QWEN] })), []);
});

test("就在正在用的那种方式里：再点一次什么都不带；换一家只带那一家，模型页配的第一跳、自定义服务不动", () => {
  const cloud = setup({ mode: "local", transcriber: "bailian/qwen3-asr-flash", polish: "custom/qwen3:8b" });
  assert.deepEqual(changesOf(planOf(cloud), cloud), {});
  assert.equal(inEffect(planOf(cloud), cloud), true);
  assert.deepEqual(changesOf({ ...planOf(cloud), polish: "deepseek" }, cloud), { polish: "deepseek" });
  const privateNow = setup({ mode: "private", privateTranscriber: SENSEVOICE });
  assert.deepEqual(changesOf(planOf(privateNow), privateNow), {});
});

test("换过去带的设置：选的就是设置里那家时不带，免得把挑好的模型换回默认的", () => {
  const s = setup({ mode: "native", native: "openai/gpt-audio-mini", polish: "moonshot/kimi-k2" });
  assert.deepEqual(changesOf({ mode: "native", native: "openai" }, s), {});
  assert.deepEqual(changesOf({ mode: "native", native: "bailian" }, s), { model: "bailian" });
  assert.deepEqual(changesOf({ mode: "local", polish: "moonshot" }, s), { transcriber: QWEN });
  assert.deepEqual(changesOf({ mode: "local", polish: "deepseek" }, s), { transcriber: QWEN, polish: "deepseek" });
  assert.deepEqual(changesOf({ mode: "private" }, s), { privateTranscriber: QWEN });
});

test("已经是这一套了（再点一次不用换）：方式一样、要带的设置也都一样", () => {
  const plan = { mode: "private", native: "gemini", polish: "deepseek" };
  assert.equal(inEffect(plan, setup({ mode: "native", installed: [QWEN] })), false);
  assert.equal(inEffect(plan, setup({ mode: "private", installed: [QWEN] })), true);
  // 模型还没下好也算：设置已经是它了
  assert.equal(inEffect(plan, setup({ mode: "private", privateTranscriber: SENSEVOICE })), true);
  assert.equal(inEffect({ ...plan, mode: "native", native: "openai" }, setup({ key: "ready" })), false);
  assert.equal(inEffect({ ...plan, mode: "native" }, setup()), true);
});

test("现在能不能说：不差什么是 null；只差模型在下是进行中；缺 key、没开始下是还差；key 在验、模型在装是进行中", () => {
  assert.equal(readinessOf(setup({ key: "ready" })), null);
  // 存着却没通过：带着原因，比"缺密钥"准
  assert.deepEqual(readinessOf(setup({ key: "rejected" })), {
    tone: "problem",
    needs: [{ kind: "key", vendor: "gemini" }],
    problem: "这把 key 无效",
  });
  assert.deepEqual(readinessOf(setup()), { tone: "problem", needs: [{ kind: "key", vendor: "gemini" }] });
  assert.deepEqual(readinessOf(setup({ mode: "private", downloading: [QWEN] })), {
    tone: "progress",
    needs: [{ kind: "download", model: QWEN, downloading: true }],
  });
  assert.equal(readinessOf(setup({ mode: "local", downloading: [QWEN] })).tone, "problem", "还差 DeepSeek 的 key");
  assert.equal(readinessOf(setup({ mode: "private" })).tone, "problem", "没开始下");
  assert.deepEqual(readinessOf(setup({ key: "checking" })), { tone: "progress", needs: [] });
  const loading = setup({
    mode: "private",
    installed: [QWEN],
    provider: null,
    key: "ready",
    localModel: { state: "loading" },
  });
  assert.deepEqual(readinessOf(loading), { tone: "progress", needs: [] });
  const failed = { state: "failed", problem: "本地模型没装上" };
  assert.deepEqual(readinessOf(setup({ mode: "private", installed: [QWEN], key: "ready", localModel: failed })), {
    tone: "problem",
    needs: [],
    problem: "本地模型没装上",
  });
});
