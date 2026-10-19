import { findModel, MODELS, makerOf } from "../models/catalog.mjs";
import {
  CLOUD_TRANSCRIBERS,
  cloudModelOf,
  cloudTranscriberOf,
  findCloudTranscriber,
} from "../server/asr/cloud/vendors.mjs";
import { PROMPT_VOCABULARY } from "../vocabulary/support.mjs";
import { hopsOf } from "./model-plaza.mjs";

// 词典页（renderer/hub/vocabulary.mjs）要讲清的两件事：哪些模型用得上词典、各怎么收，现在这条路线每一跳收不收。
// 都从模型清单里写的 vocabulary 读（vocabulary/support.mjs），这里不另写：清单改了，页面跟着变。
//   原生识别、润色：都是读提示词的大模型，全部写进提示词
//   转写：本机、云端的每个模型各自写明，不收的是 null

/** 收法写成页面要的样子：上限没有的写 null（JSON 里放不下无穷大） */
const plain = (support) =>
  support
    ? {
        kind: support.kind,
        maxTerms: Number.isFinite(support.maxTerms) ? support.maxTerms : null,
        maxChars: Number.isFinite(support.maxChars) ? support.maxChars : null,
      }
    : null;

/** 转写这一跳的收法：云端的按 厂商/模型 查清单，本机的按 id；清单外的当作不收 */
function transcriberSupport(transcriber) {
  const cloud = cloudTranscriberOf(transcriber);
  if (cloud) return cloudModelOf(findCloudTranscriber(cloud.vendor), cloud.model)?.vocabulary ?? null;
  return findModel(transcriber)?.vocabulary ?? null;
}

/**
 * 哪些模型用得上词典、各怎么收
 * @returns {{ native: object, polish: object,
 *   transcribe: Array<{ platform: string, maker: string | null, name: string, vocabulary: object | null }> }}
 *   platform：本机模型是 local，云端的是厂商 id
 */
export function describeVocabularySupport() {
  return {
    native: plain(PROMPT_VOCABULARY),
    polish: plain(PROMPT_VOCABULARY),
    transcribe: [
      ...MODELS.map((model) => ({
        platform: "local",
        maker: makerOf(model),
        name: model.name,
        vocabulary: plain(model.vocabulary),
      })),
      ...CLOUD_TRANSCRIBERS.flatMap((vendor) =>
        vendor.models.map((model) => ({
          platform: vendor.id,
          maker: model.maker,
          name: model.name,
          vocabulary: plain(model.vocabulary),
        })),
      ),
    ],
  };
}

/**
 * 一条路线一路经过的模型（同模型页的 hopsOf），每一跳带上它收词表的做法；不收的是 null
 * @param {object} route storage/settings.mjs 的 routeOf 拼出来的
 */
export function vocabularyHops(route) {
  return hopsOf(route).map((hop) => ({
    ...hop,
    kind: (hop.role === "transcribe" ? transcriberSupport(route.transcriber) : PROMPT_VOCABULARY)?.kind ?? null,
  }));
}
