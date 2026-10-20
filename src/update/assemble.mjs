import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  symlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { LocalizedError, msg } from "../i18n/index.mjs";
import { chunksOf, sha256 } from "./chunker.mjs";
import { chunksIn } from "./manifest.mjs";
import { unpackObject } from "./objects.mjs";

// 照一份清单拼出一棵目录树：本机已经有的块（种子：装着的那几份 SpeakMore）直接拷，没有的才下载。
// 更新时下载的量就是"本机缺的块"，和从哪个版本升、跳了几版、改动在哪一层都没关系。
// 每一块写进去之前都核对 sha256：本机拷的、下载的都一样，拼出来的树和发布的那棵逐字节相同，
// 所以拼完以后照旧核对签名（bundle.mjs）、照旧试跑（安装脚本），信任链不变。

/** 一棵树里的普通文件（不跟着符号链接走：链接指着的东西在树里另有一份） */
function filesUnder(root) {
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

/**
 * 把本机的种子切块，记下清单要的块在哪个文件的哪个位置
 * @param {string[]} seeds 本机装着的几份（目录）。不存在的跳过
 * @returns {Promise<Map<string, { file: string, offset: number, size: number }>>}
 */
export async function indexSeeds(seeds, manifest) {
  const wanted = chunksIn(manifest);
  const index = new Map();
  for (const root of seeds) {
    if (!root || !existsSync(root)) continue;
    for (const file of filesUnder(root)) {
      for (const { offset, size, sha256: sha } of chunksOf(readFileSync(file))) {
        if (wanted.has(sha) && !index.has(sha)) index.set(sha, { file, offset, size });
      }
      // 一个文件切完让一下：在 App 里跑时界面不卡
      await yieldToLoop();
    }
  }
  return index;
}

/**
 * @param {object} options
 * @param {ReturnType<import("./manifest.mjs").parseManifest>} options.manifest
 * @param {string} options.dest 拼到哪：不存在，或者是空目录
 * @param {string[]} [options.seeds] 本机装着的几份（indexSeeds）
 * @param {Map} [options.seedIndex] 已经切好的种子（测试用；给了就不再切 seeds）
 * @param {(shas: string[], into: string, onBytes?: (bytes: number) => void) => Promise<void>} options.fetchObjects
 *   把这些对象（压着的）下到 into 目录，文件名就是 sha256；onBytes 报每次下到的字节数
 * @param {string} options.cacheDir 下到的对象放哪。中途断了留着，再来一次只下剩下的；拼好以后由调用方删掉
 * @param {(progress: { downloadedChunks: number, totalChunks: number, downloadedBytes: number }) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ downloadedChunks: number, downloadedBytes: number, reusedBytes: number }>}
 */
export async function assembleTree({
  manifest,
  dest,
  seeds = [],
  seedIndex,
  fetchObjects,
  cacheDir,
  onProgress,
  signal,
}) {
  if (existsSync(dest) && readdirSync(dest).length > 0) throw new Error(`要拼到的 ${dest} 不是空的`);
  const index = seedIndex ?? (await indexSeeds(seeds, manifest));
  signal?.throwIfAborted();
  mkdirSync(cacheDir, { recursive: true });
  const cachedPath = (sha) => join(cacheDir, sha);
  const missing = [...chunksIn(manifest).keys()].filter((sha) => !index.has(sha) && !existsSync(cachedPath(sha)));

  let downloadedChunks = 0;
  let downloadedBytes = 0;
  let reusedBytes = 0;
  const fetchSome = async (shas) => {
    await fetchObjects(shas, cacheDir, (bytes) => {
      downloadedBytes += bytes;
      onProgress?.({ downloadedChunks, totalChunks: missing.length, downloadedBytes });
    });
    downloadedChunks += shas.length;
    onProgress?.({ downloadedChunks, totalChunks: missing.length, downloadedBytes });
  };
  onProgress?.({ downloadedChunks, totalChunks: missing.length, downloadedBytes });
  if (missing.length > 0) await fetchSome(missing);
  signal?.throwIfAborted();

  const seedFiles = new Map();
  const readSeed = ({ file, offset, size }) => {
    let fd = seedFiles.get(file);
    if (fd === undefined) {
      fd = openSync(file, "r");
      seedFiles.set(file, fd);
    }
    const data = Buffer.alloc(size);
    const read = readSync(fd, data, 0, size, offset);
    return read === size ? data : null;
  };
  /** 一块的内容：本机有、而且还对得上就拷；不然用缓存里下到的（缓存里坏了的重新下一次） */
  const chunkData = async (sha, size) => {
    const seed = index.get(sha);
    if (seed) {
      const data = readSeed(seed);
      if (data && sha256(data) === sha) {
        reusedBytes += size;
        return data;
      }
    }
    if (!existsSync(cachedPath(sha))) await fetchSome([sha]);
    try {
      return unpackObject(readFileSync(cachedPath(sha)), sha);
    } catch {
      rmSync(cachedPath(sha), { force: true });
      await fetchSome([sha]);
      try {
        return unpackObject(readFileSync(cachedPath(sha)), sha);
      } catch (error) {
        throw new LocalizedError(msg("update.checksum", { object: sha.slice(0, 12) }), { cause: error });
      }
    }
  };

  try {
    mkdirSync(dest, { recursive: true });
    for (const entry of manifest.entries) {
      signal?.throwIfAborted();
      const target = join(dest, ...entry.path.split("/"));
      if (entry.type === "dir") {
        mkdirSync(target, { recursive: true });
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      if (entry.type === "link") {
        symlinkSync(entry.target, target);
        continue;
      }
      const mode = entry.exec ? 0o755 : 0o644;
      const fd = openSync(target, "wx", mode);
      try {
        for (const [sha, size] of entry.chunks) writeSync(fd, await chunkData(sha, size));
      } finally {
        closeSync(fd);
      }
      // 建文件时的权限会被 umask 削掉：再设一次
      chmodSync(target, mode);
    }
  } finally {
    for (const fd of seedFiles.values()) closeSync(fd);
  }
  return { downloadedChunks, downloadedBytes, reusedBytes };
}
