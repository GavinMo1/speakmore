import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { modelItems, noteItems, noticeText } from "../../../scripts/release/models-layout.mjs";
import { findModel } from "../../../src/models/catalog.mjs";

const QWEN_INT8 = findModel("qwen3-asr-0.6b-int8");
const REVISION = QWEN_INT8.origin.revision;

test("模型文件：照本机模型仓的路径取，传到 <模型 id>/<提交>/<路径>，大小和校验值照配置表，传上去就不再改", () => {
  const items = modelItems(QWEN_INT8, "/store");
  assert.equal(items.length, Object.keys(QWEN_INT8.files).length);
  const vocab = items.find(({ key }) => key.endsWith("vocab.json"));
  assert.deepEqual(vocab, {
    // 本机的路径按本机的写法拼；传上去的 key 一律是 /
    path: join("/store", "qwen3-asr-0.6b-int8", "tokenizer", "vocab.json"),
    key: `qwen3-asr-0.6b-int8/${REVISION}/tokenizer/vocab.json`,
    size: QWEN_INT8.files.tokenizerVocab.size,
    sha256: QWEN_INT8.files.tokenizerVocab.sha256,
    cacheControl: "public, max-age=31536000, immutable",
    contentType: "application/json",
    immutable: true,
  });
  assert.equal(items.find(({ key }) => key.endsWith("merges.txt")).contentType, "text/plain; charset=utf-8");
  assert.equal(items.find(({ key }) => key.endsWith(".onnx")).contentType, "application/octet-stream");
});

test("两份说明和模型文件放在同一个目录，措辞可以改", () => {
  assert.deepEqual(
    noteItems(QWEN_INT8).map(({ key, immutable }) => [key, immutable]),
    [
      [`qwen3-asr-0.6b-int8/${REVISION}/LICENSE`, false],
      [`qwen3-asr-0.6b-int8/${REVISION}/NOTICE`, false],
    ],
  );
});

test("NOTICE 注明原作者、来源仓库和提交、许可，列出每个文件的 sha256，接上原仓库自带的 NOTICE", () => {
  const text = noticeText(findModel("sensevoice-small-q8"), "Modifications: converted to GGUF.\n");
  assert.match(text, /^SenseVoice Small \(Q8_0\)\n/);
  assert.match(text, /mirror of https:\/\/huggingface\.co\/handy-computer\/SenseVoiceSmall-gguf\nat commit ff8f085a/);
  assert.match(text, /originally released by FunAudioLLM\/SenseVoiceSmall/);
  assert.match(text, /License: FunASR Model License\. Full text in LICENSE/);
  assert.match(text, /6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29 {2}SenseVoiceSmall-Q8_0\.gguf/);
  assert.match(
    text,
    /---- NOTICE from handy-computer\/SenseVoiceSmall-gguf ----\n\nModifications: converted to GGUF\.\n$/,
  );
  assert.doesNotMatch(noticeText(QWEN_INT8, null), /---- NOTICE/);
});
