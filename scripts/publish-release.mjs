#!/usr/bin/env node
// 把打好的发布包（dist/release/）传到腾讯云 COS。安装脚本和官网的下载链接都从那里取。
// 用法：scripts/with-cos-key.sh npm run publish-release       本机发：密钥和桶从本机配置里带上
//       npm run publish-release -- --dry-run                 只列出要传什么，不联网
// CI 里密钥和桶直接在环境变量里，不用包 with-cos-key.sh 那一层。
//
// 要的环境变量：
//   TENCENTCLOUD_SECRET_ID、TENCENTCLOUD_SECRET_KEY  能写这个桶的密钥
//   COS_BUCKET、COS_REGION                          传到哪个桶。桶名里带着账号的编号，所以不写在仓库里
//
// 传什么、按什么先后、哪些不许覆盖，都在 release-layout.mjs 里；这里只管和 COS 说话。

import { join, resolve } from "node:path";
import COS from "cos-nodejs-sdk-v5";
import { planUpload, publish } from "./release-layout.mjs";

const releaseDir = join(resolve(import.meta.dirname, ".."), "dist", "release");

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--dry-run");
if (unknown.length > 0) {
  console.error(`不认识的参数：${unknown.join(" ")}。只认 --dry-run`);
  process.exit(2);
}

/** SDK 抛出来的东西里带着整个请求（连签名），不能原样打进日志：只取说明问题的那几项 */
function describeCosError(error) {
  if (error instanceof Error) return error.message;
  return [error?.statusCode, error?.code, error?.message].filter(Boolean).join(" ") || "未知错误";
}

function cosStore({ bucket, region, secretId, secretKey }) {
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

try {
  const items = planUpload(releaseDir);
  if (args.includes("--dry-run")) {
    for (const item of items) console.log(`${item.key}  ${item.size} 字节  ${item.cacheControl}`);
    process.exit(0);
  }

  const env = {
    secretId: process.env.TENCENTCLOUD_SECRET_ID,
    secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
    bucket: process.env.COS_BUCKET,
    region: process.env.COS_REGION,
  };
  const names = {
    secretId: "TENCENTCLOUD_SECRET_ID",
    secretKey: "TENCENTCLOUD_SECRET_KEY",
    bucket: "COS_BUCKET",
    region: "COS_REGION",
  };
  const missing = Object.keys(names).filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `环境变量没有设：${missing.map((key) => names[key]).join("、")}。本机发布用 scripts/with-cos-key.sh npm run publish-release`,
    );
  }

  await publish(items, cosStore(env), console.log);
  console.log(`\n发布好了：${items.length} 个文件都在上面。`);
} catch (error) {
  console.error(`没有发布成：${error.message}`);
  process.exit(1);
}
