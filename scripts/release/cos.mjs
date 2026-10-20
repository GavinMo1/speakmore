// 和腾讯云 COS 说话的那一层：发布（publish-release.mjs）用它。
// 只有 list、head 和 put 三样，上面的 release-layout.mjs 的 publish 照着清单调它们。

import { readFileSync } from "node:fs";
import COS from "cos-nodejs-sdk-v5";

/** SDK 抛出来的东西里带着整个请求（连签名），不能原样打进日志：只取说明问题的那几项 */
export function describeCosError(error) {
  if (error instanceof Error) return error.message;
  return [error?.statusCode, error?.code, error?.message].filter(Boolean).join(" ") || "未知错误";
}

/** 比这大的切成片传；小的一次传完，内容带着 MD5，传坏了 COS 当场拒收 */
const SLICE_SIZE = 8 * 1024 * 1024;

export function cosStore({ bucket, region, secretId, secretKey }) {
  const cos = new COS({ SecretId: secretId, SecretKey: secretKey, UploadCheckContentMd5: true });
  const target = { Bucket: bucket, Region: region };
  return {
    /** 这个前缀下有哪些对象：名字 → 大小。一次最多列一千个，接着上次的往下列 */
    async list(prefix) {
      const found = new Map();
      let marker = "";
      for (;;) {
        let page;
        try {
          page = await cos.getBucket({ ...target, Prefix: prefix, Marker: marker, MaxKeys: 1000 });
        } catch (error) {
          throw new Error(`列不了 ${prefix}：${describeCosError(error)}`);
        }
        for (const { Key, Size } of page.Contents) found.set(Key, Number(Size));
        if (page.IsTruncated !== "true") return found;
        marker = page.NextMarker || page.Contents.at(-1).Key;
      }
    },
    async head(key) {
      try {
        const { headers } = await cos.headObject({ ...target, Key: key });
        return { size: Number(headers["content-length"]), sha256: headers["x-cos-meta-sha256"] ?? "" };
      } catch (error) {
        if (error?.statusCode === 404) return null;
        throw new Error(`查不了 ${key}：${describeCosError(error)}`);
      }
    },
    async put(item) {
      const options = {
        ...target,
        Key: item.key,
        ContentType: item.contentType,
        CacheControl: item.cacheControl,
        // 带着校验值：下次发布靠它判断"上面的和本机的是不是同一份"（对象按名字认，不用它）
        ...(item.sha256 && { "x-cos-meta-sha256": item.sha256 }),
      };
      try {
        if (item.size <= SLICE_SIZE) {
          await cos.putObject({ ...options, Body: readFileSync(item.path) });
        } else {
          // 包有一百多兆，一次传完的话中途断一下就得从头来（实测断过）：切成片传，断了只重传那一片
          await cos.uploadFile({ ...options, FilePath: item.path, SliceSize: SLICE_SIZE });
        }
      } catch (error) {
        throw new Error(`传不上 ${item.key}：${describeCosError(error)}`);
      }
    },
  };
}
