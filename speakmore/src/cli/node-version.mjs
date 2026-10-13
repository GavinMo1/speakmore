// 这个文件不能引入任何别的模块：它要在加载其余代码（其中有 node:sqlite）之前就能跑。

/**
 * 这个 Node 版本能不能用。历史库用的是 Node 自带的 SQLite，它不用额外加启动参数是从
 * 22.13 和 23.4 开始的（22.12 上实测会报"没有 node:sqlite 这个模块"）。
 * @param {string} version process.versions.node
 * @returns {string | null} 不能用时是一句说明
 */
export function nodeVersionProblem(version) {
  const [major, minor] = version.split(".").map(Number);
  const ok = major > 23 || (major === 23 && minor >= 4) || (major === 22 && minor >= 13);
  return ok ? null : `SpeakMore 需要 Node 22.13 或更新的版本（23 系列要 23.4 以上），现在是 ${version}。`;
}
