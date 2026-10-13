// 只读解包 asar：按前缀挑选条目写到输出目录，并导出完整文件清单。不执行包内任何代码。
// 用法：node asar-extract.mjs <app.asar> <输出目录> [前缀 ...]
//   前缀省略时只导出清单；例：node asar-extract.mjs app.asar out dist package.json
import { openSync, readSync, closeSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const [asarPath, outDir, ...prefixes] = process.argv.slice(2);
if (!asarPath || !outDir) {
  console.error('用法：node asar-extract.mjs <app.asar> <输出目录> [前缀 ...]');
  process.exit(2);
}

const fd = openSync(asarPath, 'r');
function read(offset, length) {
  const buf = Buffer.alloc(length);
  const n = readSync(fd, buf, 0, length, offset);
  if (n !== length) throw new Error(`读取不足：offset=${offset} 期望 ${length} 实得 ${n}`);
  return buf;
}

// asar 头是两层 Chromium Pickle：[4][头部 pickle 大小][头部负载大小][JSON 长度][JSON]
const prefix = read(0, 16);
const headerPickleSize = prefix.readUInt32LE(4);
const header = JSON.parse(read(16, prefix.readUInt32LE(12)).toString('utf8'));
const dataStart = 8 + headerPickleSize;

const outRoot = resolve(outDir);
const manifest = [];
const stats = { written: 0, bytes: 0, skippedUnpacked: 0, skippedLink: 0 };

function wanted(relPath) {
  return prefixes.some((p) => relPath === p || relPath.startsWith(p + '/'));
}

function walk(node, relPath) {
  for (const [name, child] of Object.entries(node.files)) {
    // 条目名来自不可信的包，拒绝任何能逃出输出目录的写法
    if (name === '..' || name === '.' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
      throw new Error(`可疑条目名：${JSON.stringify(name)}（位于 ${relPath || '/'}）`);
    }
    const childPath = relPath ? `${relPath}/${name}` : name;
    if (child.files) {
      walk(child, childPath);
      continue;
    }
    const kind = child.link ? 'link' : child.unpacked ? 'unpacked' : 'file';
    manifest.push({ path: childPath, size: child.size ?? 0, kind });
    if (!wanted(childPath)) continue;
    if (kind === 'link') {
      stats.skippedLink++;
      continue;
    }
    if (kind === 'unpacked') {
      // 这类文件不在 asar 里，实体在旁边的 app.asar.unpacked 目录
      stats.skippedUnpacked++;
      continue;
    }
    const target = resolve(outRoot, childPath);
    if (target !== outRoot && !target.startsWith(outRoot + sep)) {
      throw new Error(`路径逃逸：${childPath}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, read(dataStart + Number(child.offset), child.size));
    stats.written++;
    stats.bytes += child.size;
  }
}

try {
  if (existsSync(outRoot) && prefixes.length) {
    console.error(`输出目录已存在，为避免覆盖请先移走：${outRoot}`);
    process.exit(2);
  }
  mkdirSync(outRoot, { recursive: true });
  walk(header, '');
  writeFileSync(join(outRoot, 'asar-manifest.json'), JSON.stringify(manifest));
  console.log(
    `清单 ${manifest.length} 条；写出 ${stats.written} 个文件 ${(stats.bytes / 1e6).toFixed(1)} MB；` +
      `跳过 unpacked ${stats.skippedUnpacked}、link ${stats.skippedLink}`,
  );
} finally {
  closeSync(fd);
}
