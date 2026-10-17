// 把 scripts/screenshots.mjs 截的图传到官网图片的 COS 桶，再写 src/media.json（页面按它拼图片地址、占位）。
// README 的图也传到这个桶（官网、宣传片以后都会用），放在 readme/ 下，清单写到 docs/media.json：
//
//   ../scripts/release/with-cos-key.sh node scripts/upload-media.mjs <截图目录>     （在 website/ 下）
//   ../scripts/release/with-cos-key.sh node scripts/upload-media.mjs <图片目录> --prefix readme --manifest ../docs/media.json
//
// 桶名带着账号的编号，放在本机配置 .machine.env 的 SITE_MEDIA_BUCKET 里，地域用 COS_REGION；密钥由 with-cos-key.sh 给。
// 对象名带内容的指纹（home-light-ink.en.3f2a9c1b.webp）：图变了名字就变，CDN 和浏览器可以放心缓存一年，
// 不用去刷新缓存。传过的同名对象跳过。
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// COS 的 SDK 用仓库根上发布脚本装的那一份，官网不另装
const require = createRequire(resolve(fileURLToPath(import.meta.url), "../../../package.json"));
const COS = require("cos-nodejs-sdk-v5");

const [dir, ...options] = process.argv.slice(2);
const option = (name, fallback) => {
  const at = options.indexOf(`--${name}`);
  return at === -1 ? fallback : options[at + 1];
};
const prefix = option("prefix", "shots");
const manifestFile = resolve(option("manifest", resolve(fileURLToPath(import.meta.url), "../../src/media.json")));
const { SITE_MEDIA_BUCKET: Bucket, COS_REGION: Region, TENCENTCLOUD_SECRET_ID, TENCENTCLOUD_SECRET_KEY } = process.env;
if (!dir || !/^[a-z0-9-]+$/.test(prefix))
  throw new Error("用法：node scripts/upload-media.mjs <截图目录> [--prefix <目录名>] [--manifest <清单文件>]");
if (!Bucket || !Region)
  throw new Error("环境里没有 SITE_MEDIA_BUCKET 或 COS_REGION：照 .machine.env.example 配好，用 with-cos-key.sh 跑");
if (!TENCENTCLOUD_SECRET_ID || !TENCENTCLOUD_SECRET_KEY)
  throw new Error("环境里没有腾讯云的密钥：用 with-cos-key.sh 跑");

const cos = new COS({ SecretId: TENCENTCLOUD_SECRET_ID, SecretKey: TENCENTCLOUD_SECRET_KEY });
const call = (method, params) =>
  new Promise((done, fail) => cos[method](params, (error, data) => (error ? fail(error) : done(data))));

async function exists(Key) {
  try {
    await call("headObject", { Bucket, Region, Key });
    return true;
  } catch (error) {
    if (error.statusCode === 404) return false;
    throw error;
  }
}

const shots = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const media = {};
for (const [name, { file, width, height }] of Object.entries(shots)) {
  const body = readFileSync(join(dir, file));
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 8);
  const Key = `${prefix}/${name}.${hash}.webp`;
  if (await exists(Key)) {
    console.log("已经在上面", Key);
  } else {
    await call("putObject", {
      Bucket,
      Region,
      Key,
      Body: body,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    });
    console.log("传好了    ", Key, `${body.length} 字节`);
  }
  media[name] = { path: Key, width, height };
}

writeFileSync(manifestFile, `${JSON.stringify(media, null, 2)}\n`);
console.log(`写好了 ${manifestFile}：${Object.keys(media).length} 张`);
