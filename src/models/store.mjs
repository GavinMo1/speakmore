import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_SOURCE, downloadSize, downloadUrls } from "./catalog.mjs";

// 模型仓：把配置表（catalog.mjs）里的模型下载到本机、校验、列出、删除。App、命令行、评测用的都是它。
// 一个模型一个目录 <仓>/<模型 id>/，文件照配置表里的相对路径放。每个文件先写成 .part，sha256 对上了才改回原名；
// 断了的 .part 留着，下次（或者换下一个地址时）带 Range 从断点接着下；
// 全部下齐后写一张收据 .complete.json（钉着的那次提交和每个文件的 sha256）。有收据、且和配置表对得上，才算装好了。
// 依次试几个下载地址：用户选的下载源在前，别的源垫后（catalog.mjs 的 downloadUrls）。
// 只用 Node 自带的 fetch 和文件操作，哪个系统都一样。

const RECEIPT = ".complete.json";

/** 多久收不到一个字节就算卡住了，放弃这个地址换下一个 */
const STALL_MS = 30_000;
/** 同一个地址最多续几次：每次都有进展才接着续，免得一个时断时续的地址拖住不放 */
const MAX_RESUMES = 20;

/** 收据的内容：配置表里决定"装的是不是这一份"的那几样 */
const receiptOf = (model) => ({
  id: model.id,
  revision: model.origin.revision,
  files: Object.fromEntries(Object.values(model.files).map((file) => [file.path, file.sha256])),
});

/**
 * @param {object} options
 * @param {string} options.dir 仓放在哪
 * @param {typeof globalThis.fetch} [options.fetch] 测试时换成假的
 * @param {string} [options.source] 先从哪个下载源下（catalog.mjs 的 SOURCES，设置里的 modelSource）
 * @param {number} [options.stallMs] 多久收不到数据算卡住，测试时换成短的
 */
export function createModelStore({ dir, fetch = globalThis.fetch, source = DEFAULT_SOURCE, stallMs = STALL_MS }) {
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
      onProgress?.(file.size);
      return;
    }
    mkdirSync(dirname(target), { recursive: true });
    const failures = [];
    for (const url of downloadUrls(model, file, source)) {
      // 网络断在半路、但这一次多下了一些的：同一个地址接着续（续的成本只有没下的那部分）。
      // 一点进展都没有、或者卡住了（这个源慢）才换地址，下好的那截带到下一个地址接着续
      for (let attempt = 1; ; attempt += 1) {
        const before = partSize(target);
        try {
          await fetchTo(url, target, file, { signal, onProgress });
          return;
        } catch (error) {
          // 用户自己取消的不换地址，下好的那截留着下次续
          if (signal?.aborted) throw error;
          if (!error.stalled && partSize(target) > before && attempt < MAX_RESUMES) continue;
          failures.push(`${url}：${error.message}`);
          break;
        }
      }
    }
    throw new Error(`${file.path} 哪个地址都没下下来：\n${failures.join("\n")}`);
  }

  /**
   * 从一个地址下一个文件：先写成 .part，大小和 sha256 都对上才改回原名。卡住超过 stallMs 就放弃。
   * 已经有一截 .part 的（上次断了、上一个地址卡住了）带 Range 从断点接着要：各个源的文件一字不差，换了源也能续。
   * 网络断了、卡住、被取消时那截留着；内容不对（大小、sha256、续的起点对不上）时删掉，免得下次续出同样的错
   */
  async function fetchTo(url, target, file, { signal, onProgress }) {
    const stall = new AbortController();
    let timer;
    const kick = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => stall.abort(Object.assign(new Error(`${stallMs / 1000} 秒没收到数据`), { stalled: true })),
        stallMs,
      );
    };
    const aborted = signal ? AbortSignal.any([signal, stall.signal]) : stall.signal;
    const partial = `${target}.part`;
    /** 内容不对：那截不能留 */
    const corrupt = (message) => Object.assign(new Error(message), { corrupt: true });
    let have = partSize(target);
    if (have > file.size) {
      rmSync(partial, { force: true });
      have = 0;
    }
    // 先把已经下好的那截算进校验（大文件要几秒，算在卡住的计时外面）
    let hash = createHash("sha256");
    if (have > 0) for await (const chunk of createReadStream(partial)) hash.update(chunk);
    if (have === file.size) {
      // 上次其实下完了、只是没来得及改名：对得上直接用，对不上从头下
      if (hash.digest("hex") === file.sha256) return renameSync(partial, target);
      rmSync(partial, { force: true });
      have = 0;
      hash = createHash("sha256");
    }
    kick();
    try {
      const response = await fetch(url, {
        signal: aborted,
        redirect: "follow",
        headers: have > 0 ? { range: `bytes=${have}-` } : {},
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      if (have > 0 && response.status === 206) {
        const start = Number(/^bytes (\d+)-/.exec(response.headers.get("content-range") ?? "")?.[1]);
        if (start !== have) {
          await response.body.cancel().catch(() => {});
          throw corrupt(`续传的起点不对：要从第 ${have} 字节接着下，给的是 ${response.headers.get("content-range")}`);
        }
      } else if (have > 0) {
        // 不认 Range、给了整个文件：那截不要了，从头写
        have = 0;
        hash = createHash("sha256");
      }
      let received = have;
      onProgress?.(received);
      // 一块一块写、写完一块再要下一块：断在哪里，盘上就有到哪里，下次从那里续
      const out = await open(partial, have > 0 ? "a" : "w");
      try {
        for await (const chunk of response.body) {
          kick();
          if (received + chunk.length > file.size) {
            throw corrupt(`${file.path} 下载到的超过了配置表里的 ${file.size} 字节`);
          }
          await out.write(chunk);
          hash.update(chunk);
          received += chunk.length;
          onProgress?.(received);
        }
      } finally {
        await out.close();
      }
      if (received !== file.size) {
        throw corrupt(`${file.path} 下载到 ${received} 字节，配置表里是 ${file.size} 字节`);
      }
      const digest = hash.digest("hex");
      if (digest !== file.sha256) {
        throw corrupt(`${file.path} 的 sha256 对不上：下载到的是 ${digest}，配置表里是 ${file.sha256}`);
      }
      renameSync(partial, target);
    } catch (error) {
      if (error.corrupt) rmSync(partial, { force: true });
      // 卡住时 fetch 报的是"被取消了"，换成卡住的原因
      throw stall.signal.aborted && !signal?.aborted ? stall.signal.reason : error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    dirOf,
    isInstalled,

    /**
     * 下载并校验一个模型的全部文件。已经装好的直接返回。
     * @param {{ signal?: AbortSignal, onProgress?: (p: { received: number, total: number }) => void }} [options]
     *   onProgress：进度按整个模型算，已经下好的文件算满
     * @returns {Promise<string>} 模型目录
     */
    async install(model, { signal, onProgress } = {}) {
      if (isInstalled(model)) return dirOf(model);
      // 收据最后写：中途失败、被打断时没有收据，下次还会接着补
      rmSync(join(dirOf(model), RECEIPT), { force: true });
      const total = downloadSize(model);
      let done = 0;
      for (const file of Object.values(model.files)) {
        await download(model, file, {
          signal,
          onProgress: (received) => onProgress?.({ received: done + received, total }),
        });
        done += file.size;
      }
      writeFileSync(join(dirOf(model), RECEIPT), JSON.stringify(receiptOf(model), null, 2));
      return dirOf(model);
    },

    /**
     * 还差多少字节没下：最终的文件还不在的，按清单里的大小减去已经下好的那截算（不核对内容，下载时会核对）。
     * 下载前查磁盘空间用
     */
    missingBytes(model) {
      let missing = 0;
      for (const file of Object.values(model.files)) {
        const path = join(dirOf(model), file.path);
        if (!existsSync(path)) missing += file.size - Math.min(partSize(path), file.size);
      }
      return missing;
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

/** 一个文件已经下好的那截（<文件>.part）有多大；没有是 0 */
function partSize(target) {
  try {
    return statSync(`${target}.part`).size;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

async function sha256Of(stream) {
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}
