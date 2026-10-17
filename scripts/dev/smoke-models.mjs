#!/usr/bin/env node
// 跑通测试：一个平台上清单里的每个模型，拿同一条录音调一次，看能不能正常出结果。不评好坏，好坏交给 eval-prompt.mjs。
// 走的是产品里真的那几层（refine/refiner.mjs、asr/cloud/transcriber.mjs、refine/polisher.mjs），不另拼请求。
//
// 每次只换一端，次数随模型数线性增长，不做组合：
//   原生   每个模型单独跑：录音 → 模型 → 成品
//   转写   每个转写模型 → 固定的润色（DeepSeek 官方的 deepseek-flash）
//   润色   录音先用本机的 Qwen3-ASR 0.6B Q8 转写一次，同一段原文交给每个润色模型
// 润色和原生都要关着思考：回话里报了思考 token 的算没通过。
//
// 用法（要用到两家的 key 时套两层 with-key）：
//   scripts/dev/with-key.sh bailian scripts/dev/with-key.sh deepseek \
//     node scripts/dev/smoke-models.mjs --platform bailian --recording <录音.webm> [--out <结果.json>] [--only native,polish]
// 结果文件里有转出来的原文和成品，是用户说的话：放在 git 之外（默认在 targets/typeless/_work/smoke/）。终端上只打印数字。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createCloudTranscriber } from "../../src/server/asr/cloud/transcriber.mjs";
import { findCloudTranscriber } from "../../src/server/asr/cloud/vendors.mjs";
import { startTranscriber } from "../../src/server/asr/start.mjs";
import { toSpeech } from "../../src/server/audio/transcode.mjs";
import { findChatVendor } from "../../src/server/chat/vendors.mjs";
import { findProvider } from "../../src/server/providers/index.mjs";
import { createChatPolisher } from "../../src/server/refine/polisher.mjs";
import { createModelRefiner } from "../../src/server/refine/refiner.mjs";
import { findVendor } from "../../src/server/vendors.mjs";
import { resolvePaths } from "../../src/storage/paths.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const QUIET = { info() {}, warn() {}, error() {} };
const FIXED_POLISH = { vendor: "deepseek", model: "deepseek-flash" };
const FIXED_TRANSCRIBER = "qwen3-asr-0.6b-q8";
const ROLES = ["native", "transcribe", "polish"];

const { values } = parseArgs({
  options: {
    platform: { type: "string" },
    recording: { type: "string" },
    out: { type: "string" },
    only: { type: "string" },
  },
});
if (!values.platform || !values.recording) {
  console.error(
    "用法：smoke-models.mjs --platform <平台 id> --recording <录音.webm> [--out <结果.json>] [--only native,polish]",
  );
  process.exit(2);
}
const roles = values.only ? values.only.split(",") : ROLES;
const out = resolve(values.out ?? join(ROOT, "targets/typeless/_work/smoke", `${values.platform}.json`));

/** 那一家的 key：环境里没有就直说缺哪个变量 */
function keyOf(id) {
  const { keyEnv } = findVendor(id);
  const key = process.env[keyEnv]?.trim();
  if (!key) throw new Error(`缺少环境变量 ${keyEnv}（用 scripts/dev/with-key.sh ${id} 套上）`);
  return key;
}

/** 调一次，记下耗时、成败、这次的用量（onCall 收到的那几笔） */
async function attempt(role, model, run) {
  const calls = [];
  const startedAt = performance.now();
  try {
    const output = await run((call) => calls.push(call));
    const thinking = calls.reduce((sum, call) => sum + (call.thinkingTokens ?? 0), 0);
    const ok = output.trim() !== "" && thinking === 0;
    return {
      role,
      model,
      ok,
      ms: Math.round(performance.now() - startedAt),
      chars: output.length,
      thinkingTokens: thinking,
      costUsd: calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0),
      problem: ok ? null : thinking > 0 ? `开着思考（${thinking} 个思考 token）` : "成品是空的",
      output,
    };
  } catch (error) {
    return {
      role,
      model,
      ok: false,
      ms: Math.round(performance.now() - startedAt),
      problem: String(error?.detail ?? error?.message ?? error).slice(0, 300),
      kind: error?.kind ?? null,
    };
  }
}

const audio = readFileSync(values.recording);
const samples = await toSpeech(audio, "audio/webm");
const results = [];
const report = (result) => {
  results.push(result);
  const mark = result.ok ? "通过" : "失败";
  console.log(
    `${result.role.padEnd(10)} ${result.model.padEnd(28)} ${mark}  ${String(result.ms).padStart(6)} ms  ${String(result.chars ?? "-").padStart(4)} 字${result.problem ? `  ${result.problem}` : ""}`,
  );
};

if (roles.includes("native")) {
  const provider = findProvider(values.platform);
  for (const { id } of provider?.models ?? []) {
    report(
      await attempt("native", id, async (onCall) => {
        const refiner = await createModelRefiner({
          choice: { provider: provider.id, model: id },
          apiKey: keyOf(provider.id),
          log: QUIET,
          onCall,
        });
        return refiner.refine(audio, { mimeType: "audio/webm" });
      }),
    );
  }
}

if (roles.includes("transcribe")) {
  const vendor = findCloudTranscriber(values.platform);
  for (const { id } of vendor?.models ?? []) {
    let transcript = "";
    const result = await attempt("transcribe", id, async (onCall) => {
      const transcriber = await createCloudTranscriber({
        choice: { vendor: vendor.id, model: id },
        apiKey: keyOf(vendor.id),
        log: QUIET,
        onCall,
      });
      ({ text: transcript } = await transcriber.transcribe(samples));
      const polisher = await createChatPolisher({
        choice: FIXED_POLISH,
        apiKey: keyOf(FIXED_POLISH.vendor),
        log: QUIET,
        onCall,
      });
      return polisher.polish(transcript);
    });
    report({ ...result, transcript, polishedBy: `${FIXED_POLISH.vendor}/${FIXED_POLISH.model}` });
  }
}

if (roles.includes("polish")) {
  const vendor = findChatVendor(values.platform);
  if (vendor?.models.length) {
    const local = await startTranscriber({
      modelId: FIXED_TRANSCRIBER,
      modelsDir: resolvePaths().modelsDir,
      log: QUIET,
    });
    let transcript;
    try {
      ({ text: transcript } = await local.transcribe(samples));
    } finally {
      local.dispose();
    }
    for (const { id } of vendor.models) {
      const result = await attempt("polish", id, async (onCall) => {
        const polisher = await createChatPolisher({
          choice: { vendor: vendor.id, model: id },
          apiKey: keyOf(vendor.id),
          log: QUIET,
          onCall,
        });
        return polisher.polish(transcript);
      });
      report({ ...result, transcript, transcribedBy: FIXED_TRANSCRIBER });
    }
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({ platform: values.platform, recording: values.recording, seconds: samples.length / 16_000, at: new Date().toISOString(), results }, null, 2)}\n`,
);
const passed = results.filter(({ ok }) => ok).length;
console.log(`\n${passed}/${results.length} 通过，结果写在 ${out}`);
process.exitCode = passed === results.length ? 0 : 1;
