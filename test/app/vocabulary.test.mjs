import assert from "node:assert/strict";
import { test } from "node:test";
import { describeVocabularySupport, vocabularyHops } from "../../src/app/vocabulary.mjs";
import { MODELS } from "../../src/models/catalog.mjs";
import { CLOUD_TRANSCRIBERS } from "../../src/server/asr/cloud/vendors.mjs";
import { PROMPT_VOCABULARY } from "../../src/vocabulary/support.mjs";

test("支持的模型：原生识别、润色都是写进提示词（全部模型）；转写把本机、云端的每个模型列出来，不收的写 null", () => {
  const support = describeVocabularySupport();
  assert.deepEqual(support.native, {
    kind: "prompt",
    maxTerms: PROMPT_VOCABULARY.maxTerms,
    maxChars: PROMPT_VOCABULARY.maxChars,
    maxTermChars: null,
    maxTermWords: null,
  });
  assert.deepEqual(support.polish, support.native);
  const count = MODELS.length + CLOUD_TRANSCRIBERS.reduce((sum, vendor) => sum + vendor.models.length, 0);
  assert.equal(support.transcribe.length, count);
  const byName = Object.fromEntries(support.transcribe.map((entry) => [`${entry.platform}/${entry.name}`, entry]));
  assert.deepEqual(byName["local/Qwen3-ASR 0.6B (Q8_0)"].vocabulary, {
    kind: "hotwords",
    maxTerms: null,
    maxChars: 600,
    maxTermChars: null,
    maxTermWords: null,
  });
  assert.equal(byName["local/SenseVoice Small (Q8_0)"].vocabulary, null);
  assert.deepEqual(byName["zhipu/GLM-ASR-2512"].vocabulary, {
    kind: "hotwords",
    maxTerms: 100,
    maxChars: null,
    maxTermChars: null,
    maxTermWords: null,
  });
  // 单个词的长度也给页面（悬停时看）：百炼的热词，中文词 15 字、英文词 7 个单词
  assert.deepEqual(
    support.transcribe
      .filter(({ vocabulary }) => vocabulary?.maxTermChars)
      .map(({ vocabulary }) => [vocabulary.maxTermChars, vocabulary.maxTermWords]),
    [
      [15, 7],
      [15, 7],
    ],
  );
  assert.equal(byName["minimax/MiniMax ASR 1.0"].vocabulary, null);
  // 本机的排在云端前面
  assert.equal(support.transcribe[0].platform, "local");
});

test("当前路线：每一跳带上收法；数据隐私选 SenseVoice 时那一跳是 null（词典用不上）", () => {
  const local = vocabularyHops({
    mode: "local",
    transcriber: "bailian/qwen3-asr-flash",
    polish: { vendor: "deepseek", model: "deepseek-flash" },
    customUrl: null,
    customParams: null,
  });
  assert.deepEqual(
    local.map(({ role, kind }) => [role, kind]),
    [
      ["transcribe", "context"],
      ["polish", "prompt"],
    ],
  );
  assert.equal(local[0].name, "Qwen3 ASR Flash");

  const native = vocabularyHops({ mode: "native", model: { provider: "gemini", model: "gemini-3.6-flash" } });
  assert.deepEqual(
    native.map(({ role, kind }) => [role, kind]),
    [["native", "prompt"]],
  );

  const privateMode = vocabularyHops({ mode: "private", transcriber: "sensevoice-small-q8" });
  assert.deepEqual(
    privateMode.map(({ role, kind }) => [role, kind]),
    [["transcribe", null]],
  );
});
