import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, posix } from "node:path";
import { CHUNKING, chunksOf } from "./chunker.mjs";
import { withoutAsar } from "./no-asar.mjs";

// 清单：一个版本、一种装法（见 layout.mjs 的 TARGETS）的一整棵目录树。每个文件由哪些块按顺序拼成、是不是可执行，
// 每个符号链接指向哪，每个目录（空的也要有）。发布时由 describeTree 生成，更新时 assemble.mjs 照着拼。
// 清单本身也是一个对象（objects.mjs）：名字是内容的 sha256，channel.json 里写着每种装法用哪一份。

export const MANIFEST_FORMAT = 1;

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * 发布时：把一棵目录树切块，每块交给 put 存一份，交回清单。条目按路径排好，同样的树每次生成的清单一字不差
 * @param {string} root
 * @param {{ put: (sha256: string, data: Buffer) => void }} store 同一块可能交来好几次，存一份就行
 */
export function describeTree(root, store) {
  return withoutAsar(async () => describe(root, store));
}

function describe(root, { put }) {
  const entries = [];
  const visit = (rel) => {
    for (const name of readdirSync(rel ? join(root, rel) : root).sort()) {
      const path = rel ? `${rel}/${name}` : name;
      const full = join(root, ...path.split("/"));
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        entries.push({ path, type: "link", target: readlinkSync(full) });
      } else if (stat.isDirectory()) {
        entries.push({ path, type: "dir" });
        visit(path);
      } else if (stat.isFile()) {
        const data = readFileSync(full);
        const chunks = chunksOf(data).map(({ offset, size, sha256 }) => {
          put(sha256, data.subarray(offset, offset + size));
          return [sha256, size];
        });
        entries.push({ path, type: "file", exec: (stat.mode & 0o111) !== 0, chunks });
      } else {
        throw new Error(`${full} 既不是文件、目录，也不是符号链接，发布里不该有它`);
      }
    }
  };
  visit("");
  return { format: MANIFEST_FORMAT, chunking: CHUNKING.algorithm, entries };
}

export const encodeManifest = (manifest) => Buffer.from(JSON.stringify(manifest));

/** Windows 上有特殊含义的名字：设备名（带不带扩展名都算）；冒号会写成 NTFS 的备用数据流；末尾的点和空格会被悄悄去掉 */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
const WINDOWS_RESERVED = /[<>:"|?*]|[. ]$/;
/** 控制字符（0–31）：Windows 不许出现在名字里 */
const hasControl = (part) => [...part].some((char) => char.charCodeAt(0) < 32);

/** 一段名字：不是空的、. 或 ..，在 Windows 上也只是一个普通的名字 */
const isPlainName = (part) =>
  part !== "" &&
  part !== "." &&
  part !== ".." &&
  !WINDOWS_RESERVED.test(part) &&
  !WINDOWS_DEVICE.test(part) &&
  !hasControl(part);

/** 一条相对路径：用 / 分隔，每一段都是普通的名字，没有反斜杠 */
function isSafePath(path) {
  if (typeof path !== "string" || path === "" || path.includes("\\")) return false;
  return path.split("/").every(isPlainName);
}

/** 按文件系统认的那样比名字：macOS、Windows 默认不分大小写，macOS 也不分 Unicode 的两种写法（é 和 e + ´） */
const folded = (path) => path.normalize("NFC").toLowerCase();

/**
 * 更新时：解析、核对一份清单。不认的格式、切法，越出目录的路径、指到外面的链接、链接下面的东西、
 * 不分大小写会撞名的、Windows 上有特殊含义的名字，一律不收
 * （清单是按 sha256 取的，被换掉的可能已经很小；这里防的是坏了的发布把东西写到别处）
 * @param {Uint8Array} data
 */
export function parseManifest(data) {
  // 说的是哪里不对；是哪份清单、在哪用，由调用方加上（更新时是 update.badManifest，发布时是 release-layout.mjs）
  const bad = (why) => new Error(why);
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(data).toString("utf8"));
  } catch {
    throw bad("不是 JSON");
  }
  if (manifest?.format !== MANIFEST_FORMAT) throw bad(`格式是 ${manifest?.format}，这一版只认 ${MANIFEST_FORMAT}`);
  if (manifest.chunking !== CHUNKING.algorithm)
    throw bad(`切法是 ${manifest.chunking}，这一版只认 ${CHUNKING.algorithm}`);
  if (!Array.isArray(manifest.entries)) throw bad("没有 entries");
  const seen = new Map();
  for (const entry of manifest.entries) {
    if (!isSafePath(entry?.path)) throw bad(`路径不对：${JSON.stringify(entry?.path)}`);
    const key = folded(entry.path);
    if (seen.has(key)) throw bad(`路径重名（不分大小写）：${seen.get(key)} 和 ${entry.path}`);
    seen.set(key, entry.path);
  }
  // 链接下面不许再有东西：每个链接按字面检查都指在里面，可顺着一个链接再走另一个，就可能走到外面去
  // （a/s → ../b，再来一个 a/s/t → ../../x）。发布时 describeTree 不进链接，真的清单里本来就没有这种
  const links = new Map(
    manifest.entries.filter((entry) => entry.type === "link").map((entry) => [folded(entry.path), entry.path]),
  );
  for (const entry of manifest.entries) {
    const parts = folded(entry.path).split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      const link = links.get(parts.slice(0, depth).join("/"));
      if (link) throw bad(`${entry.path} 在链接 ${link} 下面`);
    }
  }
  for (const entry of manifest.entries) {
    if (entry.type === "dir") continue;
    if (entry.type === "link") {
      const resolved = posix.normalize(posix.join(posix.dirname(entry.path), String(entry.target)));
      if (typeof entry.target !== "string" || entry.target.startsWith("/") || !isSafePath(resolved)) {
        throw bad(`${entry.path} 指到了目录外面：${JSON.stringify(entry.target)}`);
      }
      continue;
    }
    if (entry.type !== "file") throw bad(`${entry.path} 的类型不认识：${JSON.stringify(entry.type)}`);
    if (typeof entry.exec !== "boolean" || !Array.isArray(entry.chunks)) throw bad(`${entry.path} 少了 exec 或 chunks`);
    for (const chunk of entry.chunks) {
      if (!Array.isArray(chunk) || !SHA256.test(chunk[0]) || !Number.isSafeInteger(chunk[1]) || chunk[1] < 0) {
        throw bad(`${entry.path} 的块不对：${JSON.stringify(chunk)}`);
      }
    }
  }
  return manifest;
}

/** 清单里用到的每一块（去重）：sha256 → 字节数 */
export function chunksIn(manifest) {
  const chunks = new Map();
  for (const entry of manifest.entries) {
    if (entry.type === "file") for (const [sha, size] of entry.chunks) chunks.set(sha, size);
  }
  return chunks;
}
