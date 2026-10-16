import { fork } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findEngine } from "../../../src/server/asr/engines/index.mjs";
import { splitPoints } from "../../../src/server/asr/segment.mjs";
import { decodeWav, SPEECH_SAMPLE_RATE } from "../../../src/server/audio/pcm.mjs";
import { fingerprint } from "../results.mjs";

// 转写：每个候选在一个子进程里把要跑的样本一条条转完（transcribe-worker.mjs），结果一条条进结果库，
// 中途崩了已经转完的也留着，下次只补剩下的。模型没下载的先下载（src/server/asr/store.mjs）。

const WORKER = join(import.meta.dirname, "transcribe-worker.mjs");

/**
 * 录音、模型文件、运行库版本、参数，哪样变了这一格就要重跑。
 * 一次吃不下要分段的模型，再加上这条录音实际的切点：分段的上限或算法一变，切出来不一样的格子自然重跑。
 * @param {string} datasetDir 要分段时读录音算切点
 */
export function transcribeKey(clip, candidate, engineVersion, datasetDir) {
  const { model, options } = candidate;
  const segments = model.maxSeconds
    ? splitPoints(decodeWav(readFileSync(join(datasetDir, clip.file))).samples, SPEECH_SAMPLE_RATE, model.maxSeconds)
    : null;
  return fingerprint({
    clip: clip.sha256,
    model: { id: model.id, revision: model.source.revision, files: Object.values(model.files).map((f) => f.sha256) },
    engine: { id: model.engine, version: engineVersion },
    options,
    ...(segments ? { segments } : {}),
  });
}

export async function engineVersionOf(model) {
  return (await findEngine(model.engine).load()).version();
}

/**
 * @returns {Promise<{ ran: number, failed: { clip: string, error: string }[], info?: object }>}
 */
export async function runTranscribe({ clips, candidate, results, store, datasetDir, force }) {
  const engineVersion = await engineVersionOf(candidate.model);
  const keyOf = (clip) => transcribeKey(clip, candidate, engineVersion, datasetDir);
  const todo = clips.filter((clip) => force || results.get("transcribe", keyOf(clip)) === null);
  if (todo.length === 0) return { ran: 0, failed: [] };

  const dir = await store.install(candidate.model, { onProgress: downloadProgress(candidate.model) });
  const byId = new Map(todo.map((clip) => [clip.id, clip]));
  const failed = [];
  const info = await runWorker(
    {
      model: candidate.model,
      dir,
      options: candidate.options,
      clips: todo.map((clip) => ({ id: clip.id, file: join(datasetDir, clip.file) })),
    },
    (message) => {
      if (message.type === "result") {
        results.put("transcribe", keyOf(byId.get(message.clip)), {
          clip: message.clip,
          subject: candidate.id,
          output: { text: message.text, ms: message.ms },
        });
      } else if (message.type === "error") {
        failed.push({ clip: message.clip, error: message.message });
      }
    },
  );
  results.addRun(candidate.id, { ...info, engineVersion, clips: todo.length });
  return { ran: todo.length, failed, info };
}

/** 起子进程、交活、收回报。子进程没说"做完了"就退出的（崩了）报错，说清卡在哪一条之后 */
function runWorker(job, onMessage) {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER, { serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] });
    const info = {};
    let last = null;
    child.on("message", (message) => {
      if (message.type === "loaded") Object.assign(info, { loadMs: message.loadMs, backend: message.backend });
      if (message.type === "done")
        Object.assign(info, { coldMs: message.coldMs, maxRssMb: message.maxRssMb, done: true });
      if (message.clip) last = message.clip;
      onMessage(message);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (info.done) {
        delete info.done;
        resolve(info);
      } else {
        const where = last ? `转完 ${last} 之后` : "还没转完第一条";
        reject(new Error(`转写子进程${where}退出了（退出码 ${code}，信号 ${signal}）`));
      }
    });
    child.send(job);
  });
}

/** 下载进度：每过 10% 打一行 */
function downloadProgress(model) {
  let shown = -1;
  return ({ file, received, total }) => {
    const tenth = Math.floor((received / total) * 10);
    if (tenth === shown) return;
    shown = tenth;
    console.log(`  下载 ${model.id}/${file}：${Math.round((received / total) * 100)}%`);
  };
}
