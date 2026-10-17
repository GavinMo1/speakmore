// 发布目录长什么样，以及怎么把它原样搬到下载地址上。
// 打包（release.mjs）照着它摆，上传（publish-release.mjs）照着它传，安装脚本（install.sh）照着它取：
//   install.sh                                    安装脚本
//   latest                                        一行：最新的版本号，比如 v0.2.0
//   v0.2.0/speakmore-darwin-arm64.tar.gz          这个版本的包，两种芯片各一个
//   v0.2.0/speakmore-darwin-arm64.tar.gz.sha256   和 shasum -a 256 的输出同一种格式
//   v0.2.0/SpeakMore-arm64.dmg                    直接下载的安装包：签了名、过了公证的 SpeakMore.app，两种芯片各一个
//   v0.2.0/SpeakMore-arm64.dmg.sha256             同上
//   v0.2.0/speakmore-win32-x64.zip                Windows 的包（0.9 起）：解开同样是 app\ 和 runtime\，install.ps1 照着装
//   v0.2.0/speakmore-win32-x64.zip.sha256         同上
//   install.ps1                                   Windows 的安装脚本：irm …/install.ps1 | iex

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const ARCHS = ["arm64", "x64"];
export const archiveName = (arch) => `speakmore-darwin-${arch}.tar.gz`;
export const dmgName = (arch) => `SpeakMore-${arch}.dmg`;
/** Windows 只出 x64 的一个（Windows on ARM 靠系统自带的转译跑它） */
export const WINDOWS_ARCHIVE = "speakmore-win32-x64.zip";
export const versionDir = (version) => `v${version}`;

/** 下载地址上，这个产品的东西都在这个前缀下面 */
const KEY_PREFIX = "speakmore/";
/** 传上去就不再变的：各处可以放心长期缓存 */
const IMMUTABLE = "public, max-age=31536000, immutable";
/** 每次发布都会换的：只缓存一小会儿，新版本一分钟内人人看得到 */
const MUTABLE = "public, max-age=60";
const TEXT = "text/plain; charset=utf-8";

export const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * 核对发布目录是齐的、自己对得上，列出要传的东西。
 * 顺序就是该传的先后：先传包，再传安装脚本，最后才改 latest——任何时刻照着 latest 去取，包都已经在了。
 * @param {string} releaseDir
 * @returns {{ path: string, key: string, size: number, sha256: string, cacheControl: string, contentType: string, immutable: boolean }[]}
 */
export function planUpload(releaseDir) {
  const item = (name, cacheControl, contentType) => {
    const path = join(releaseDir, name);
    if (!existsSync(path))
      throw new Error(
        `发布目录里少了 ${name}。先运行 npm run release（两种芯片和 Windows 都要打；安装包要先在 .machine.env 配好签名和公证）。`,
      );
    const immutable = cacheControl === IMMUTABLE;
    return {
      path,
      key: KEY_PREFIX + name,
      size: statSync(path).size,
      sha256: sha256(path),
      cacheControl,
      contentType,
      immutable,
    };
  };

  const latest = item("latest", MUTABLE, TEXT);
  const version = readFileSync(latest.path, "utf8").trim();
  if (!/^v\d+\.\d+\.\d+([-+.][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`发布目录里的 latest 不像版本号：${JSON.stringify(version)}`);
  }

  const items = [];
  /** 一个包和它的校验值。安装脚本、下载的人拿这个校验值核对：两样对不上的话，传上去谁也装不成 */
  const withChecksum = (name, contentType) => {
    const file = item(`${version}/${name}`, IMMUTABLE, contentType);
    const checksum = item(`${version}/${name}.sha256`, IMMUTABLE, TEXT);
    if (readFileSync(checksum.path, "utf8").split(/\s+/)[0] !== file.sha256) {
      throw new Error(`${name} 和它的 .sha256 对不上。重新运行 npm run release。`);
    }
    return [file, checksum];
  };
  for (const arch of ARCHS) {
    items.push(
      ...withChecksum(archiveName(arch), "application/gzip"),
      ...withChecksum(dmgName(arch), "application/x-apple-diskimage"),
    );
  }
  items.push(...withChecksum(WINDOWS_ARCHIVE, "application/zip"));
  // install.ps1 要按 UTF-8 读：irm 照 charset 解码，里面有中文注释
  items.push(
    item("install.sh", MUTABLE, "text/x-shellscript; charset=utf-8"),
    item("install.ps1", MUTABLE, "text/plain; charset=utf-8"),
    latest,
  );
  return items;
}

/**
 * 照着清单传。上面已经有、而且一样的跳过，所以中途断了可以重来。
 * @param {ReturnType<typeof planUpload>} items
 * @param {{ head: (key: string) => Promise<{ size: number, sha256: string } | null>, put: (item: object) => Promise<void> }} store
 * @param {(line: string) => void} log
 */
export async function publish(items, store, log) {
  const same = (remote, item) => remote !== null && remote.size === item.size && remote.sha256 === item.sha256;
  for (const item of items) {
    const existing = await store.head(item.key);
    if (same(existing, item)) {
      log(`已经在上面  ${item.key}`);
      continue;
    }
    // 发布过的版本不改：已经有人装了它，各处的缓存里也是它。要改就升版本号
    if (existing !== null && item.immutable) {
      throw new Error(`${item.key} 已经发布过，内容和这次的不一样。发布过的版本不改，要改就升版本号再发。`);
    }
    await store.put(item);
    if (!same(await store.head(item.key), item)) {
      throw new Error(`${item.key} 传上去之后和本机的对不上（大小或校验值不一样）。再运行一次。`);
    }
    log(`传好了      ${item.key}（${item.size} 字节）`);
  }
}
