// 本地模型的国内源上长什么样：每个模型一个目录 <模型 id>/<原始地址钉住的提交>/（src/models/catalog.mjs 的 mirrorKey），
// 里面是和原始地址一字不差的模型文件，外加两份随文件分发的说明：
//   LICENSE   许可原文（配置表里 license.url 那一份）
//   NOTICE    这是谁的模型、从哪个仓库哪次提交来的、每个文件的 sha256，后面接原仓库自带的 NOTICE（有的话）
// FunASR 的许可要求注明来源和作者、保留模型名；Apache-2.0 要求随文件给出许可原文、保留原有的 NOTICE。
// 上传（sync-models.mjs）照着这里列出的清单传，传的办法和发布包一样（release-layout.mjs 的 publish）。

import { join } from "node:path";
import { mirrorKey } from "../../src/models/catalog.mjs";

/** 模型文件按提交钉住，传上去就不再变：各处可以放心长期缓存 */
const IMMUTABLE = "public, max-age=31536000, immutable";
/** 两份说明是我们写的、可能改措辞：缓存一天 */
const NOTES = "public, max-age=86400";
const TEXT = "text/plain; charset=utf-8";

/** 模型文件的类型：词表、配置是文字，权重一律当二进制 */
function contentTypeOf(path) {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".txt")) return TEXT;
  return "application/octet-stream";
}

/**
 * 一个模型要传的模型文件：本机模型仓里的那一份（storeDir/<模型 id>/<路径>），大小和校验值照配置表。
 * 本机那一份对不对，由调用方先核对过（sync-models.mjs 逐个算 sha256）
 * @param {object} model 配置表里的一项
 * @param {string} storeDir 本机模型仓的目录（src/models/store.mjs 的 dir）
 */
export function modelItems(model, storeDir) {
  return Object.values(model.files).map((file) => ({
    path: join(storeDir, model.id, file.path),
    key: mirrorKey(model, file.path),
    size: file.size,
    sha256: file.sha256,
    cacheControl: IMMUTABLE,
    contentType: contentTypeOf(file.path),
    immutable: true,
  }));
}

/**
 * 两份说明要传成的样子。path、size、sha256 由调用方写好文件后补上
 * @returns {{ name: string, key: string, cacheControl: string, contentType: string, immutable: boolean }[]}
 */
export function noteItems(model) {
  return ["LICENSE", "NOTICE"].map((name) => ({
    name,
    key: mirrorKey(model, name),
    cacheControl: NOTES,
    contentType: TEXT,
    immutable: false,
  }));
}

/**
 * NOTICE 的内容。英文写：看它的人不一定懂中文
 * @param {object} model 配置表里的一项
 * @param {string | null} upstream 原仓库自带的 NOTICE（没有是 null）
 */
export function noticeText(model, upstream) {
  const { origin } = model;
  const lines = [
    model.name,
    "",
    `These files are a byte-identical mirror of https://huggingface.co/${origin.repo}`,
    `at commit ${origin.revision}, kept by SpeakMore (https://github.com/zephyr4123/speakmore)`,
    "so that its users can download them quickly from China.",
    "",
    `Model: ${model.name}, originally released by ${model.author} (https://huggingface.co/${model.author}).`,
    `License: ${model.license.name}. Full text in LICENSE, copied from ${model.license.url}`,
    "",
    "Files (sha256):",
    ...Object.values(model.files).map((file) => `  ${file.sha256}  ${file.path}`),
  ];
  if (upstream) lines.push("", `---- NOTICE from ${origin.repo} ----`, "", upstream.trim());
  return `${lines.join("\n")}\n`;
}
