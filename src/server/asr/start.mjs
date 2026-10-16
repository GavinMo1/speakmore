import { downloadSize, findModel } from "./catalog.mjs";
import { spawnTranscriber } from "./host.mjs";
import { createModelStore } from "./store.mjs";

// 把一个本地模型准备好、能用：没下载过就先下载（模型广场以后也走这里），再在转写进程里装上。
// 单独启动的服务端和后台应用都用它，用户不用自己去下模型。

/**
 * @param {object} options
 * @param {string} options.modelId 清单里的 id（catalog.mjs）
 * @param {string} options.modelsDir 模型放在哪（storage/paths.mjs 的 modelsDir）
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 * @param {(progress: { received: number, total: number }) => void} [options.onProgress] 下载进度，按整个模型算
 * @param {AbortSignal} [options.signal] 取消下载
 * @param {object} [options.options] 交给运行库的参数（backend、threads…）
 * @returns {Promise<Awaited<ReturnType<typeof spawnTranscriber>>>}
 */
export async function startTranscriber({
  modelId,
  modelsDir,
  log,
  onProgress,
  signal,
  options,
  store = createModelStore({ dir: modelsDir }),
  spawn = spawnTranscriber,
}) {
  const model = findModel(modelId);
  if (!model) throw new Error(`模型清单里没有 ${modelId}`);
  if (!store.isInstalled(model)) {
    const total = downloadSize(model);
    log.info("model_downloading", { model: model.id, bytes: total });
    const startedAt = performance.now();
    // 各个文件的进度合成整个模型的
    const done = new Map();
    await store.install(model, {
      signal,
      onProgress: ({ file, received }) => {
        done.set(file, received);
        onProgress?.({ received: [...done.values()].reduce((sum, bytes) => sum + bytes, 0), total });
      },
    });
    log.info("model_downloaded", { model: model.id, ms: Math.round(performance.now() - startedAt) });
  }
  return spawn({ model, dir: store.dirOf(model), options, log });
}
