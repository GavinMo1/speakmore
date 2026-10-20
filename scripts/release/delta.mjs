// 这次打的发布和下载地址上现在的比：每种装法升上来要下多少，版本号有没有往回退。只算、不碰网络（delta-report.mjs 取数）。

import { compareVersions } from "../../src/update/versions.mjs";

/** Electron 没换时一次更新最多下这么多（压过的），超了多半是打包出了问题（比如每次打出来的文件都不一样，块对不上） */
export const LIMIT_BYTES = 20 * 1024 * 1024;

/**
 * @param {object} options
 * @param {{ version: string, electron: string, targets: Record<string, string> }} options.local 这次打的
 * @param {{ version: string, electron: string, targets: Record<string, string> }} options.live 下载地址上现在的
 * @param {(target: string, sha: string) => Map<string, number>} options.localChunks 这次某种装法的清单里的块
 * @param {(target: string, sha: string) => Map<string, number> | null} options.liveChunks 线上那份清单里的块
 * @param {(sha: string) => number} options.packedSize 本机 store/ 里一个对象（压过的）多大
 * @returns {{ rows: { target: string, bytes: number, chunks: number, fresh: boolean }[], tooBig: string[], refuse: string | null }}
 *   rows：每种装法要下多少（fresh：上一版没有这种装法）；tooBig：Electron 没换却超了 LIMIT_BYTES 的；
 *   refuse：不该发的原因（版本号往回退了，或者同一个版本号、内容却不一样）
 */
export function compareReleases({ local, live, localChunks, liveChunks, packedSize }) {
  const order = compareVersions(local.version, live.version);
  let refuse = null;
  if (order < 0) refuse = `这次的 ${local.version} 比下载地址上的 ${live.version} 旧：发出去等于让所有人退回旧版本`;
  if (order === 0 && JSON.stringify(local.targets) !== JSON.stringify(live.targets)) {
    refuse = `下载地址上已经是 ${live.version}，内容和这次打的不一样：发布过的版本不改，要改就升版本号`;
  }
  const sameElectron = local.electron === live.electron;
  const rows = [];
  const tooBig = [];
  for (const [target, sha] of Object.entries(local.targets)) {
    const now = localChunks(target, sha);
    const liveSha = live.targets[target];
    const before = liveSha ? (liveChunks(target, liveSha) ?? new Map()) : new Map();
    const missing = [...now.keys()].filter((chunk) => !before.has(chunk));
    // 要下的是压过的对象，加上清单本身
    const bytes = [sha, ...missing].reduce((sum, chunk) => sum + packedSize(chunk), 0);
    rows.push({ target, bytes, chunks: missing.length, fresh: !liveSha });
    if (sameElectron && liveSha && bytes > LIMIT_BYTES) tooBig.push(target);
  }
  return { rows, tooBig, refuse };
}
