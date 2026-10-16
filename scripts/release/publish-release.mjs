#!/usr/bin/env node
// 把打好的发布包（dist/release/）传到腾讯云 COS。安装脚本和官网的下载链接都从那里取。
// 发新版本用 npm run ship（scripts/release/ship.sh），它会先把关、打包，再调这里。单独用：
//   scripts/release/with-cos-key.sh npm run publish-release       密钥和桶从本机配置里带上；传到一半断了就再跑一次
//   npm run publish-release -- --dry-run                         只列出要传什么，不联网
//
// 要的环境变量：
//   TENCENTCLOUD_SECRET_ID、TENCENTCLOUD_SECRET_KEY  能写这个桶的密钥
//   COS_BUCKET、COS_REGION                          传到哪个桶。桶名里带着账号的编号，所以不写在仓库里
//
// 传什么、按什么先后、哪些不许覆盖，都在 release-layout.mjs 里；和 COS 说话的在 cos.mjs，这里只把它们接起来。

import { join, resolve } from "node:path";
import { cosStore } from "./cos.mjs";
import { planUpload, publish } from "./release-layout.mjs";

const releaseDir = join(resolve(import.meta.dirname, "../.."), "dist", "release");

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--dry-run");
if (unknown.length > 0) {
  console.error(`不认识的参数：${unknown.join(" ")}。只认 --dry-run`);
  process.exit(2);
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
      `环境变量没有设：${missing.map((key) => names[key]).join("、")}。本机发布用 scripts/release/with-cos-key.sh npm run publish-release`,
    );
  }

  await publish(items, cosStore(env), console.log);
  console.log(`\n发布好了：${items.length} 个文件都在上面。`);
} catch (error) {
  console.error(`没有发布成：${error.message}`);
  process.exit(1);
}
