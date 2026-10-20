import { constants, cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// 搬家时拷什么、怎么拷。只认 SpeakMore 自己的东西（照 storage/paths.mjs 的摆法算出来的那几样，加上每家的 key）：
//   move       要搬的：程序、你的设置和数据、模型、日志、缓存
//   leftovers  我们的、但不搬的：run/（进程号、锁、套接字，都是运行时的）、更新和安装被打断留下的半截。搬完跟旧目录一起删
//   unknown    不认识的（0.11.0 时 SPEAKMORE_HOME 可能指到了一个本来就有别的东西的目录）：不搬，也不删，搬完说出来
// 拷的时候符号链接原样拷（Electron 框架里是相对链接；Node 默认会改写成指向旧目录的绝对路径，旧目录一删程序就起不来），
// APFS 上用克隆（不多占空间），修改时间原样；目标已经有同名的就报错，不覆盖。

/** 更新、安装被打断留下的半截（update/home.mjs 的 .update-、install.sh 的 .install.、换下来的 app.old 这些） */
const LEFTOVER = /^\.update-|^\.install\.|^(app|runtime)\.old(\..+)?$/;
/** 每家一把 key（storage/paths.mjs 的 keyFile、oldAppKeyFile） */
const KEY_FILE = /^[a-z0-9]+-key(\.app)?\.bin$/;
/** Chromium 在缓存目录里的单实例锁（SingletonLock、SingletonSocket、SingletonCookie）：属于正在运行的那一个，不拷 */
const CHROMIUM_SINGLETON = /^Singleton/;

/** 家目录里我们的顶层名字：照 paths 里的每一项算出来，摆法改了这里跟着变 */
function ourNames(paths) {
  const names = new Set();
  for (const [name, value] of Object.entries(paths)) {
    if (name === "home" || typeof value !== "string") continue;
    const inside = relative(paths.home, value);
    if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) continue;
    names.add(inside.split(sep)[0]);
  }
  return names;
}

/** current 指着的那个版本（Windows 的摆法）；没有、读不出是 null */
function currentVersion(paths) {
  try {
    const name = readFileSync(paths.currentFile, "utf8").trim();
    return name && !/[\\/]/.test(name) && name !== "." && name !== ".." ? name : null;
  } catch {
    return null;
  }
}

/**
 * 把家目录里的东西分成三类
 * @param {ReturnType<import("../storage/paths.mjs").resolvePaths>} paths
 * @returns {{ move: string[], leftovers: string[], unknown: string[], current: string | null }}
 */
export function classifyHome(paths) {
  const ours = ourNames(paths);
  const run = relative(paths.home, paths.runDir);
  const plan = { move: [], leftovers: [], unknown: [], current: currentVersion(paths) };
  for (const name of readdirSync(paths.home)) {
    if (name === run || LEFTOVER.test(name)) plan.leftovers.push(name);
    else if (ours.has(name) || KEY_FILE.test(name)) plan.move.push(name);
    else plan.unknown.push(name);
  }
  return plan;
}

/**
 * 把要搬的拷到新家目录
 * @param {{ from: string, to: string, plan: ReturnType<typeof classifyHome> }} options
 * @returns {{ files: number, bytes: number }} 拷了多少个文件、多少字节
 */
export function copyHome({ from, to, plan }) {
  mkdirSync(to, { recursive: true });
  const stats = { files: 0, bytes: 0 };
  const versions = join(from, "versions");
  const filter = (source) => {
    const name = basename(source);
    if (dirname(source) === join(from, "cache") && CHROMIUM_SINGLETON.test(name)) return false;
    // versions 下只拷 current 指着的那个：别的是换下来、还没删掉的旧版本
    if (dirname(source) === versions && name !== plan.current) return false;
    const info = lstatSync(source);
    if (info.isFile()) {
      stats.files++;
      stats.bytes += info.size;
    }
    return true;
  };
  for (const name of plan.move) {
    cpSync(join(from, name), join(to, name), {
      recursive: true,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      // APFS、ReFS 上克隆，不多占空间；不支持的盘照常拷
      mode: constants.COPYFILE_FICLONE,
      filter,
    });
  }
  return stats;
}

/**
 * 核对拷好的：每个符号链接都要是相对的、落在新家目录里面。不然旧目录一删就断了（Node 默认拷链接会改写成绝对路径）
 * @throws {Error} 说哪个链接不对
 */
export function verifyCopy({ to }) {
  const root = resolve(to);
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(path);
        if (isAbsolute(target)) throw new Error(`absolute symlink: ${path} -> ${target}`);
        const resolved = resolve(dirname(path), target);
        if (resolved !== root && !resolved.startsWith(root + sep)) {
          throw new Error(`symlink would escape the folder: ${path} -> ${target}`);
        }
      } else if (entry.isDirectory()) {
        walk(path);
      }
    }
  };
  walk(root);
}
