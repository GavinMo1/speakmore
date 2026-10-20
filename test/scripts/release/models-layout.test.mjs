import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { checkRemote, licenseId, noticeText, readmeText, repoFiles } from "../../../scripts/release/models-layout.mjs";
import { findModel, MODELSCOPE_OWNER } from "../../../src/models/catalog.mjs";

const QWEN_INT8 = findModel("qwen3-asr-0.6b-int8");
const SENSEVOICE = findModel("sensevoice-small-q8");

test("模型文件：照本机模型仓的路径取，在魔搭仓库里的路径和原始仓库一样，大小和校验值照配置表", () => {
  const files = repoFiles(QWEN_INT8, "/store");
  assert.equal(files.length, Object.keys(QWEN_INT8.files).length);
  assert.deepEqual(
    files.find(({ path }) => path.endsWith("vocab.json")),
    {
      // 本机的路径按本机的写法拼；仓库里的路径一律是 /
      local: join("/store", "qwen3-asr-0.6b-int8", "tokenizer", "vocab.json"),
      path: "tokenizer/vocab.json",
      size: QWEN_INT8.files.tokenizerVocab.size,
      sha256: QWEN_INT8.files.tokenizerVocab.sha256,
    },
  );
});

test("许可：Apache-2.0 照魔搭的写法；FunASR 的许可魔搭没有，记成 other，原文在 LICENSE 里", () => {
  assert.equal(licenseId(QWEN_INT8), "apache-2.0");
  assert.equal(licenseId(SENSEVOICE), "other");
});

test("NOTICE 注明原作者、来源仓库和提交、许可，列出每个文件的 sha256，接上原仓库自带的 NOTICE", () => {
  const text = noticeText(SENSEVOICE, "Modifications: converted to GGUF.\n");
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

test("模型卡（README.md）：开头是魔搭认的元数据（许可、任务），正文说清来源、作者和许可，指向 NOTICE", () => {
  const text = readmeText(SENSEVOICE);
  assert.match(text, /^---\nlicense: other\ntasks:\n- auto-speech-recognition\n---\n/);
  assert.match(text, /# SenseVoice Small \(Q8_0\)/);
  assert.match(text, /https:\/\/huggingface\.co\/handy-computer\/SenseVoiceSmall-gguf/);
  assert.match(text, /FunAudioLLM\/SenseVoiceSmall/);
  assert.match(text, /NOTICE/);
  assert.match(readmeText(QWEN_INT8), /^---\nlicense: apache-2\.0\n/);
});

/** 魔搭列文件接口给的一项（/api/v1/models/<仓库>/repo/files） */
const remote = (path, { size, sha256, revision = "r1".padEnd(40, "0"), at = 1 } = {}) => ({
  Path: path,
  Type: "blob",
  Size: size,
  Sha256: sha256,
  Revision: revision,
  CommittedDate: at,
});

test("传完的核对：每个模型文件都在、大小和 sha256 都对；最新的那次提交就是要钉的", () => {
  const files = Object.values(SENSEVOICE.files);
  const listing = [
    ...files.map((file) =>
      remote(file.path, { size: file.size, sha256: file.sha256, revision: "a".repeat(40), at: 5 }),
    ),
    remote("LICENSE", { size: 1, sha256: "x", revision: "b".repeat(40), at: 9 }),
    remote(".gitattributes", { size: 1, sha256: "y", revision: "c".repeat(40), at: 1 }),
  ];
  assert.deepEqual(checkRemote(SENSEVOICE, listing), { head: "b".repeat(40), problems: [] });
});

test("传完的核对：缺文件、大小不对、内容不对都报出来，说清是哪个仓库的哪个文件", () => {
  const [file] = Object.values(SENSEVOICE.files);
  const repo = `${MODELSCOPE_OWNER}/sensevoice-small-q8`;
  assert.deepEqual(checkRemote(SENSEVOICE, []).problems, [`${repo} 上没有 ${file.path}`]);
  assert.deepEqual(checkRemote(SENSEVOICE, [remote(file.path, { size: 3, sha256: file.sha256 })]).problems, [
    `${repo} 上的 ${file.path} 是 3 字节，配置表里是 ${file.size} 字节`,
  ]);
  assert.deepEqual(checkRemote(SENSEVOICE, [remote(file.path, { size: file.size, sha256: "f".repeat(64) })]).problems, [
    `${repo} 上的 ${file.path} 的 sha256 是 ${"f".repeat(64)}，配置表里是 ${file.sha256}`,
  ]);
});
