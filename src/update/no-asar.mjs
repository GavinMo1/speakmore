// Electron 改过的 fs 把路径里带 .asar 的当成归档：读的是归档里面的东西，往一个新建的 .asar 文件里写会报 "Invalid package"。
// 当 Node 跑（ELECTRON_RUN_AS_NODE，命令行和 App 起的更新进程都是这么跑的）时也一样。
// 运行环境里就有 default_app.asar（原版 Electron.app 带的），切块、拼树时要把它当普通文件原样读写。
// process.noAsar 只在 Electron 里起作用，普通 Node（发布脚本、单测）里设了也没影响。

/**
 * 在关掉 asar 的情况下做完 work，再恢复原样
 * @template T
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withoutAsar(work) {
  const before = process.noAsar;
  process.noAsar = true;
  try {
    return await work();
  } finally {
    process.noAsar = before;
  }
}
