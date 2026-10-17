import { findModel } from "../../models/catalog.mjs";
import { createModelStore } from "../../models/store.mjs";
import { findEngine } from "./engines/index.mjs";
import { spawnTranscriber } from "./host.mjs";

// 把一个下载好的本地模型装进转写进程。下载不在这里：下不下、什么时候下由用户点（models/library.mjs），
// 不能一切到 local 模式就悄悄下几百兆。
//
// 用不用显卡看设置里的 acceleration：auto 有显卡就用，在显卡上没装起来（运行库报错，或者驱动把转写进程弄崩了）
// 就换 CPU 再装一次——显卡和驱动五花八门，不能指望每一台都行；cpu 一开始就只用 CPU。

/**
 * @param {object} options
 * @param {string} options.modelId 配置表里的 id（models/catalog.mjs）
 * @param {string} options.modelsDir 模型放在哪（storage/paths.mjs 的 modelsDir）
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 * @param {object} [options.options] 交给运行库的别的参数（threads…）；用不用显卡由 acceleration 定
 * @param {"auto" | "cpu"} [options.acceleration] 设置里的 acceleration
 * @returns {Promise<Awaited<ReturnType<typeof spawnTranscriber>>>}
 */
export async function startTranscriber({
  modelId,
  modelsDir,
  log,
  options = {},
  acceleration = "auto",
  store = createModelStore({ dir: modelsDir }),
  spawn = spawnTranscriber,
}) {
  const model = findModel(modelId);
  if (!model) throw new Error(`模型清单里没有 ${modelId}`);
  if (!store.isInstalled(model)) throw new Error(`${model.id} 还没下载`);
  const dir = store.dirOf(model);
  const on = (backend) => spawn({ model, dir, options: { ...options, backend }, log });
  if (acceleration === "cpu" || !findEngine(model.engine)?.gpu) return on(acceleration === "cpu" ? "cpu" : "auto");
  try {
    return await on("auto");
  } catch (error) {
    log.warn("transcriber_gpu_failed", { model: model.id, error: String(error?.message ?? error) });
    return on("cpu");
  }
}
