import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

// 模型仓：把清单（catalog.mjs）里的模型下载到本机、校验、列出、删除。模型广场和评测用的都是它。
// 一个模型一个目录 <仓>/<模型 id>/，文件照清单里的相对路径放。每个文件先写成 .part，sha256 对上了才改回原名；
// 全部下齐后写一张收据 .complete.json（钉着的那次提交和每个文件的 sha256）。有收据、且和清单对得上，才算装好了。
// 只用 Node 自带的 fetch 和文件操作，哪个系统都一样。

const RECEIPT = ".complete.json";

/** 下载地址：Hugging Face 上钉在某一次提交的那个文件。国内连不上时换镜像，换掉这一个函数 */
export const huggingFace = (model, file) =>
  `https://huggingface.co/${model.source.repo}/resolve/${model.source.revision}/${file.path}`;

/** 收据的内容：清单里决定"装的是不是这一份"的那几样 */
const receiptOf = (model) => ({
  id: model.id,
  revision: model.source.revision,
  files: Object.fromEntries(Object.values(model.files).map((file) => [file.path, file.sha256])),
});

/**
 * @param {object} options
 * @param {string} options.dir 仓放在哪
 * @param {typeof globalThis.fetch} [options.fetch] 测试时换成假的
 * @param {(model: object, file: object) => string} [options.urlOf] 文件从哪下
 */
export function createModelStore({ dir, fetch = globalThis.fetch, urlOf = huggingFace }) {
  const dirOf = (model) => join(dir, model.id);

  function isInstalled(model) {
    const path = join(dirOf(model), RECEIPT);
    if (!existsSync(path)) return false;
    return JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) === JSON.stringify(receiptOf(model));
  }

  /** 已经在那儿、内容也对的文件不再下：断了重来时只补缺的 */
  async function alreadyThere(path, file) {
    if (!existsSync(path)) return false;
    return (await sha256Of(createReadStream(path))) === file.sha256;
  }

  async function download(model, file, { signal, onProgress }) {
    const target = join(dirOf(model), file.path);
    if (await alreadyThere(target, file)) {
      onProgress?.({ file: file.path, received: file.size, total: file.size });
      return;
    }
    mkdirSync(dirname(target), { recursive: true });
    const url = urlOf(model, file);
    const response = await fetch(url, { signal, redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`下载 ${url} 失败：HTTP ${response.status}`);
    const partial = `${target}.part`;
    const hash = createHash("sha256");
    let received = 0;
    const meter = new Transform({
      transform(chunk, _encoding, done) {
        hash.update(chunk);
        received += chunk.length;
        onProgress?.({ file: file.path, received, total: file.size });
        done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial), { signal });
      if (received !== file.size) throw new Error(`${file.path} 下载到 ${received} 字节，清单里是 ${file.size} 字节`);
      const digest = hash.digest("hex");
      if (digest !== file.sha256)
        throw new Error(`${file.path} 的 sha256 对不上：下载到的是 ${digest}，清单里是 ${file.sha256}`);
      renameSync(partial, target);
    } catch (error) {
      rmSync(partial, { force: true });
      throw error;
    }
  }

  return {
    dirOf,
    isInstalled,

    /**
     * 下载并校验一个模型的全部文件。已经装好的直接返回。
     * @param {{ signal?: AbortSignal, onProgress?: (p: { file: string, received: number, total: number }) => void }} [options]
     * @returns {Promise<string>} 模型目录
     */
    async install(model, options = {}) {
      if (isInstalled(model)) return dirOf(model);
      // 收据最后写：中途失败、被打断时没有收据，下次还会接着补
      rmSync(join(dirOf(model), RECEIPT), { force: true });
      for (const file of Object.values(model.files)) await download(model, file, options);
      writeFileSync(join(dirOf(model), RECEIPT), JSON.stringify(receiptOf(model), null, 2));
      return dirOf(model);
    },

    /** 删掉一个模型的整个目录。没装过的什么也不做 */
    remove(model) {
      rmSync(dirOf(model), { recursive: true, force: true });
    },

    /** 装好了的模型 id（目录里有收据的） */
    installed() {
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, RECEIPT)))
        .map((entry) => entry.name)
        .sort();
    },
  };
}

async function sha256Of(stream) {
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}
