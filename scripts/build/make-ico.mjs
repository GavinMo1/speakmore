#!/usr/bin/env node
// 把几张 PNG 打成一个 Windows 的 .ico：node scripts/build/make-ico.mjs <输出.ico> <16.png> <32.png> …
// .ico 就是一个文件头、一张目录、后面接着各个尺寸的图；从 Vista 起每张图可以直接放 PNG，不用转成位图。
// 由 make-icon.sh 调用，几行能写清，不为它引依赖。
import { readFileSync, writeFileSync } from "node:fs";

/** PNG 的宽高在 IHDR 里：签名 8 字节、块长度和类型各 4 字节之后 */
function pngSize(png) {
  if (png.readUInt32BE(12) !== 0x49484452) throw new Error("不是 PNG（找不到 IHDR）");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const [output, ...inputs] = process.argv.slice(2);
if (!output || inputs.length === 0) {
  console.error("用法：node scripts/build/make-ico.mjs <输出.ico> <png…>");
  process.exit(2);
}
const images = inputs.map((file) => ({ file, png: readFileSync(file) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // 1 是图标
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(({ file, png }) => {
  const { width, height } = pngSize(png);
  if (width > 256 || height > 256) throw new Error(`${file} 是 ${width}×${height}，.ico 里一张最大 256`);
  const entry = Buffer.alloc(16);
  // 宽高写 0 表示 256
  entry.writeUInt8(width % 256, 0);
  entry.writeUInt8(height % 256, 1);
  entry.writeUInt16LE(1, 4); // 色彩平面
  entry.writeUInt16LE(32, 6); // 每像素 32 位
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
writeFileSync(output, Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]));
