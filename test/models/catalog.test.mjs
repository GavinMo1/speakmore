import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createTranslator } from "../../src/i18n/index.mjs";
import {
  CHIPS,
  chipOf,
  DEFAULT_SOURCE,
  DEFAULT_TRANSCRIBER,
  downloadSize,
  downloadUrls,
  findModel,
  findSource,
  MODELS,
  MODELSCOPE_OWNER,
  measuredOn,
  mirrorRepo,
  SOURCES,
  TAGS,
  tagsOn,
} from "../../src/models/catalog.mjs";
import { backendText, measuredFacts, measuredText, nameParts, tagTexts } from "../../src/models/describe.mjs";
import { findEngine } from "../../src/server/asr/engines/index.mjs";

const ROOT = join(import.meta.dirname, "../..");
const CHIP_IDS = CHIPS.map(({ id }) => id);

test("配置表：id 不重复，只用小写字母、数字、点和横线（它也是模型的目录名、魔搭上的仓库名）", () => {
  const ids = MODELS.map((model) => model.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9][a-z0-9.-]*$/);
  assert.equal(findModel(ids[0]), MODELS[0]);
  assert.equal(findModel("nope"), null);
  assert.ok(findModel(DEFAULT_TRANSCRIBER), "默认的转写模型在配置表里");
});

test("配置表：每个文件是仓库里的相对路径，带大小和 sha256；原始地址钉在某一次提交上", () => {
  for (const model of MODELS) {
    assert.match(model.origin.repo, /^[\w.-]+\/[\w.-]+$/, model.id);
    assert.match(model.origin.revision, /^[0-9a-f]{40}$/, model.id);
    if ("maxSeconds" in model) assert.ok(model.maxSeconds > 0, `${model.id} 的 maxSeconds`);
    for (const file of Object.values(model.files)) {
      assert.match(file.path, /^[\w.-]+(\/[\w.-]+)*$/, `${model.id} ${file.path}`);
      assert.ok(!file.path.split("/").includes(".."), `${model.id} ${file.path}`);
      assert.match(file.sha256, /^[0-9a-f]{64}$/, `${model.id} ${file.path}`);
      assert.ok(Number.isInteger(file.size) && file.size > 0, `${model.id} ${file.path}`);
    }
  }
  const sizes = Object.values(MODELS[0].files).map((file) => file.size);
  assert.equal(
    downloadSize(MODELS[0]),
    sizes.reduce((a, b) => a + b, 0),
  );
});

test("配置表：许可有名字和原文地址，注明原作者的仓库（往国内源上传时一起带上）", () => {
  for (const model of MODELS) {
    assert.ok(model.license.name, model.id);
    assert.match(model.license.url, /^https:\/\//, model.id);
    assert.match(model.author, /^[\w.-]+\/[\w.-]+$/, model.id);
    if (model.origin.notice !== undefined) assert.match(model.origin.notice, /^[\w.-]+$/, model.id);
  }
});

test("配置表：用的运行库登记过，它认得这一族，填配置时要的文件配置表里都有", async () => {
  for (const model of MODELS) {
    const engine = findEngine(model.engine);
    assert.ok(engine, `${model.id} 的运行库 ${model.engine}`);
    const { FAMILIES } = await engine.load();
    assert.ok(FAMILIES[model.family], `${engine.name} 认不认 ${model.family}`);
    const asked = [];
    FAMILIES[model.family].config((role) => {
      assert.ok(model.files[role], `${model.id} 缺 ${role}`);
      asked.push(role);
      return `/models/${model.id}/${model.files[role].path}`;
    });
    assert.ok(asked.length > 0);
  }
});

test("词典：配置表里写了收词表的模型，它的运行库认得怎么放；没写的不放。只有 Qwen3-ASR 收（2026-10-19 两种运行库都实测过）", async () => {
  for (const model of MODELS) {
    const { FAMILIES } = await findEngine(model.engine).load();
    const place = model.vocabulary ? FAMILIES[model.family].vocabulary?.[model.vocabulary.kind] : undefined;
    assert.equal(Boolean(model.vocabulary), typeof place === "function", model.id);
    if (!model.vocabulary) assert.equal(FAMILIES[model.family].vocabulary, undefined, model.id);
    assert.equal(Boolean(model.vocabulary), model.family === "qwen3-asr", model.id);
    if (model.vocabulary) assert.equal(model.vocabulary.kind, "hotwords");
  }
});

test("配置表全是数据：整项能原样复制（装本机模型时交给转写进程；混进函数就装不上）", () => {
  assert.deepEqual(structuredClone(MODELS), MODELS);
});

test("标签按实测打：适合哪类芯片、能用什么跑，measured 里都要有对应的那一条", () => {
  for (const model of MODELS) {
    for (const tag of model.tags) {
      assert.ok(Object.hasOwn(TAGS, tag), `${model.id} 的标签 ${tag} 没登记`);
      if (TAGS[tag] === "chip") {
        assert.ok(CHIP_IDS.includes(tag), `${tag} 不在 CHIPS 里`);
        assert.ok(
          model.measured.some(({ chip }) => chip === tag),
          `${model.id} 标了 ${tag} 却没在上面测过`,
        );
      }
      if (TAGS[tag] === "backend") {
        assert.ok(
          model.measured.some(({ backend }) => backend === tag),
          `${model.id} 标了 ${tag} 却没用它跑过`,
        );
      }
    }
    for (const entry of model.measured) {
      assert.ok(CHIP_IDS.includes(entry.chip), `${model.id} 测的芯片 ${entry.chip}`);
      assert.equal(TAGS[entry.backend], "backend", `${model.id} 的 ${entry.backend} 要登记成 backend`);
      assert.ok(entry.score >= 0 && entry.score <= 5, `${model.id} 均分`);
      for (const name of ["p50Ms", "realtime", "peakMB"]) assert.ok(entry[name] > 0, `${model.id} ${name}`);
      assert.ok(existsSync(join(ROOT, "bench/results", `${entry.run}.md`)), `${model.id} 的 ${entry.run} 没有报告`);
    }
  }
});

test("给人看的标签按这台机器的芯片挑：在别类芯片上测出来的芯片、加速标签不拿过来说，强项不分芯片", () => {
  const model = {
    tags: ["apple-silicon", "metal", "cpu", "zh-en"],
    measured: [
      { chip: "apple-silicon", backend: "metal" },
      { chip: "apple-silicon", backend: "cpu" },
      { chip: "windows-x64", backend: "cpu" },
    ],
  };
  assert.deepEqual(tagsOn(model, "apple-silicon"), ["apple-silicon", "metal", "cpu", "zh-en"]);
  assert.deepEqual(tagsOn(model, "windows-x64"), ["cpu", "zh-en"]);
  assert.deepEqual(tagsOn(model, null), ["zh-en"]);
});

test("运行库报的设备名翻成加速方式：MTL0 是 Metal，Vulkan0 是 Vulkan，CPU 是 CPU，不认得的照原样", () => {
  const t = createTranslator("zh-CN");
  assert.equal(t.text(backendText("MTL0")), "Metal");
  assert.equal(t.text(backendText("Vulkan0")), "Vulkan");
  assert.equal(t.text(backendText("CPU")), "CPU");
  assert.equal(t.text(backendText("CUDA0")), "CUDA0");
});

test("Windows（x64）上：两个 Q8 模型标着适合 Windows、能用 Vulkan 加速，测过 CPU 的标能只用 CPU；不提 Apple 芯片和 Metal", () => {
  const qwen = findModel("qwen3-asr-0.6b-q8");
  const sense = findModel("sensevoice-small-q8");
  for (const model of [qwen, sense]) {
    const tags = tagsOn(model, "windows-x64");
    for (const tag of ["windows-x64", "vulkan", "cpu"]) assert.ok(tags.includes(tag), `${model.id} 缺 ${tag}`);
    assert.ok(!tags.includes("apple-silicon") && !tags.includes("metal"), `${model.id}：${tags}`);
    assert.equal(measuredOn(model, "windows-x64")[0].backend, "vulkan", `${model.id} 在 Windows 上最快的是 Vulkan`);
  }
  for (const id of ["qwen3-asr-0.6b-int8", "sensevoice-small-int8"]) {
    assert.ok(measuredOn(findModel(id), "windows-x64").length > 0, `${id} 在 Windows 上测过`);
  }
});

test("每个标签、芯片、加速后端在两种界面语言里都有说法", () => {
  for (const locale of ["zh-CN", "en"]) {
    const t = createTranslator(locale);
    for (const tag of Object.keys(TAGS)) assert.notEqual(t(`localModels.tags.${tag}`), `localModels.tags.${tag}`);
    for (const chip of CHIP_IDS) assert.notEqual(t(`localModels.chips.${chip}`), `localModels.chips.${chip}`);
    for (const [backend, kind] of Object.entries(TAGS)) {
      if (kind === "backend") assert.notEqual(t(`localModels.backends.${backend}`), `localModels.backends.${backend}`);
    }
    for (const { id } of SOURCES) assert.notEqual(t(`modelSources.${id}`), `modelSources.${id}`);
  }
});

test("认芯片：Apple 芯片、Intel Mac、Windows 两种；别的是 null", () => {
  assert.equal(chipOf("darwin", "arm64"), "apple-silicon");
  assert.equal(chipOf("darwin", "x64"), "intel-mac");
  assert.equal(chipOf("win32", "x64"), "windows-x64");
  assert.equal(chipOf("win32", "arm64"), "windows-arm64");
  assert.equal(chipOf("linux", "x64"), null);
});

test("某类芯片上的实测：跑得快的在前，写成一句话；没测过、认不出的芯片都如实说", () => {
  const zh = createTranslator("zh-CN");
  const q8 = findModel("qwen3-asr-0.6b-q8");
  const measured = measuredOn(q8, "apple-silicon");
  assert.deepEqual(
    measured.map(({ backend }) => backend),
    ["metal", "cpu"],
  );
  assert.equal(
    zh.text(measuredText(measured, "apple-silicon")),
    "Apple 芯片上实测（Metal）：均分 4.14/5 · 68 倍实时 · 内存 2.0 GB",
  );
  assert.equal(
    zh.text(measuredText(measuredOn(q8, "windows-x64"), "windows-x64")),
    "Windows（x64）上实测（Vulkan）：均分 4.16/5 · 73 倍实时 · 内存 0.5 GB",
  );
  assert.deepEqual(measuredOn(q8, "intel-mac"), []);
  assert.equal(zh.text(measuredText([], "intel-mac")), "Intel Mac上还没实测");
  assert.equal(zh.text(measuredText([], null)), "这类机器上还没实测");
  assert.deepEqual(
    tagTexts(["metal", "zh-en"]).map((text) => zh.text(text)),
    ["Metal 加速", "中英夹杂准"],
  );
});

test("App 的模型列表把实测拆开摆：三个数各一格，在什么机器上测的另一句；没测过的只有那一句", () => {
  const zh = createTranslator("zh-CN");
  const facts = measuredFacts(measuredOn(findModel("qwen3-asr-0.6b-q8"), "apple-silicon"), "apple-silicon");
  assert.deepEqual(
    facts.figures.map(({ value, unit, label }) => [value, unit, zh.text(label)]),
    [
      ["4.14", "/5", "均分"],
      ["68", "×", "速度"],
      ["2.0", "GB", "内存"],
    ],
  );
  assert.equal(zh.text(facts.where), "Apple 芯片 · Metal 实测");
  const untested = measuredFacts([], "windows-x64");
  assert.deepEqual(untested.figures, []);
  assert.equal(zh.text(untested.where), "Windows（x64）上还没实测");
  assert.equal(zh.text(measuredFacts([], null).where), "这类机器上还没实测");
});

test("型号的名字分成名字和量化档两段；没有括号的整个是名字", () => {
  assert.deepEqual(nameParts("Qwen3-ASR 0.6B (Q8_0)"), { base: "Qwen3-ASR 0.6B", variant: "Q8_0" });
  assert.deepEqual(nameParts("SenseVoice Small (int8)"), { base: "SenseVoice Small", variant: "int8" });
  assert.deepEqual(nameParts("Whisper"), { base: "Whisper", variant: null });
  for (const { name } of MODELS) assert.notEqual(nameParts(name).variant, null, name);
});

test("下载源：默认国内源（魔搭）在前，原始地址垫后；选了原始地址就倒过来。都按 sha256 校验，从哪下的都一样", () => {
  assert.ok(findSource(DEFAULT_SOURCE));
  assert.equal(new Set(SOURCES.map(({ id }) => id)).size, SOURCES.length);
  const model = findModel("sensevoice-small-q8");
  const file = model.files.gguf;
  const { revision, repo } = model.origin;
  const cn = `https://modelscope.cn/models/${MODELSCOPE_OWNER}/sensevoice-small-q8/resolve/${model.mirror.revision}/SenseVoiceSmall-Q8_0.gguf`;
  const hf = `https://huggingface.co/${repo}/resolve/${revision}/SenseVoiceSmall-Q8_0.gguf`;
  const mirror = `https://hf-mirror.com/${repo}/resolve/${revision}/SenseVoiceSmall-Q8_0.gguf`;
  assert.equal(mirrorRepo(model), `${MODELSCOPE_OWNER}/sensevoice-small-q8`);
  assert.deepEqual(downloadUrls(model, file), [cn, hf, mirror]);
  assert.deepEqual(downloadUrls(model, file, "original"), [hf, mirror, cn]);
  assert.throws(() => downloadUrls(model, file, "ftp"), /ftp.*cn \/ original/);
});

test("每个模型都钉在魔搭的一次提交上（sync-models.mjs 传完报出来的），原始地址也钉在一次提交上", () => {
  for (const model of MODELS) {
    assert.match(
      model.mirror.revision,
      /^[0-9a-f]{40}$/,
      `${model.id} 的 mirror.revision 还没填：跑 sync-models 传到魔搭`,
    );
    assert.match(model.origin.revision, /^[0-9a-f]{40}$/, model.id);
  }
});
