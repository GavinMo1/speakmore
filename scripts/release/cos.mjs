// 和腾讯云 COS 说话的那一层：发布包（publish-release.mjs）和本地模型的国内源（sync-models.mjs）都用它。
// 只有 head 和 put 两样，上面的 release-layout.mjs 的 publish 照着清单调它们。

import COS from "cos-nodejs-sdk-v5";

/** SDK 抛出来的东西里带着整个请求（连签名），不能原样打进日志：只取说明问题的那几项 */
export function describeCosError(error) {
  if (error instanceof Error) return error.message;
  return [error?.statusCode, error?.code, error?.message].filter(Boolean).join(" ") || "未知错误";
}

export function cosStore({ bucket, region, secretId, secretKey }) {
  const cos = new COS({ SecretId: secretId, SecretKey: secretKey });
  const target = { Bucket: bucket, Region: region };
  return {
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
      try {
        // 包有一百多兆，一次传完的话中途断一下就得从头来（实测断过）：大的切成片传，断了只重传那一片
        await cos.uploadFile({
          ...target,
          Key: item.key,
          FilePath: item.path,
          SliceSize: 8 * 1024 * 1024,
          ContentType: item.contentType,
          CacheControl: item.cacheControl,
          // 桶里的对象自己带着校验值：下次发布靠它判断"上面的和本机的是不是同一份"
          "x-cos-meta-sha256": item.sha256,
        });
      } catch (error) {
        throw new Error(`传不上 ${item.key}：${describeCosError(error)}`);
      }
    },
  };
}
