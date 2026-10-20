import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { LocalizedError, msg } from "../i18n/index.mjs";

// 定位文件：SpeakMore 的目录（家目录）装在哪。它是 SpeakMore 在家目录以外唯一留下的文件，
// 位置固定，所以从哪儿启动的都找得到：Mac 上"应用程序"里的 App、安装脚本、Windows 的安装程序、从源码跑的。
//   macOS    ~/.config/speakmore/location.json
//   Windows  %LOCALAPPDATA%\SpeakMore\location.json
// 内容是 { "home": "<家目录的绝对路径>" }。安装脚本每次装完都写（install.sh、install.ps1），speakmore move 搬完写，
// 完整卸载时删。没有它就是默认位置（0.11.0 及以前装的都在那里）。
// 读它的不止这里：install.sh、install.ps1、native/windows-setup 各有一份，位置和格式以这里为准，
// test/storage/location-everywhere.test.mjs 核对几处写的是同一个。

/** 不认 XDG_CONFIG_HOME：从程序坞打开的 App 拿不到终端里设的环境变量，认它的话 App 和命令行会看不同的文件 */
const MAC_DIR = [".config", "speakmore"];
/** Windows 上放在本机的 AppData\Local（不随漫游配置同步到别的电脑：那里不一定有这个盘） */
const WINDOWS_DIR = "SpeakMore";
const FILE_NAME = "location.json";

const pathModule = (platform) => (platform === "win32" ? win32 : posix);

/**
 * 定位文件在哪
 * @param {Record<string, string | undefined>} env 用它的 LOCALAPPDATA（Windows）
 * @param {string} userHome 用户的家目录
 * @param {NodeJS.Platform} platform
 */
export function locationFileOf(env, userHome, platform) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || win32.join(userHome, "AppData", "Local");
    return win32.join(local, WINDOWS_DIR, FILE_NAME);
  }
  return posix.join(userHome, ...MAC_DIR, FILE_NAME);
}

/** 规范成完整写法（去掉 .、..、末尾的分隔符），和安装脚本算出来的是同一个字符串 */
function normalized(home, platform) {
  return pathModule(platform).resolve(home);
}

/**
 * 是不是一个完整的路径：不随"在哪个目录、哪个盘上运行"而变。Windows 上要带盘符（D:\）或者是网络路径（\\server\share），
 * 只是 \ 开头的指的是当前那个盘的根
 */
export function isFullPath(home, platform) {
  if (platform === "win32") return /^[A-Za-z]:[\\/]/.test(home) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(home);
  return posix.isAbsolute(home);
}

/**
 * 读定位文件说的家目录。没有这个文件是 null。读不了、内容不对都抛 LocalizedError：
 * 不能悄悄退回默认位置，那样会在默认位置新建一个空目录，用户看着像数据丢了
 * @param {string} file
 * @param {NodeJS.Platform} platform 按哪个系统认绝对路径
 * @returns {string | null}
 */
export function readLocation(file, platform) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new LocalizedError(msg("location.unreadable", { file, reason: error.code ?? error.message }), {
      cause: error,
    });
  }
  let home;
  try {
    home = JSON.parse(text.replace(/^﻿/, "")).home;
  } catch {
    home = undefined;
  }
  // 控制字符（换行这些）不会出现在正经的路径里，安装脚本也读不对它
  const valid = typeof home === "string" && isFullPath(home, platform) && !/[\u0000-\u001f]/.test(home);
  if (!valid) throw new LocalizedError(msg("location.invalid", { file }));
  return normalized(home, platform);
}

/**
 * 记下家目录在哪。先写到旁边再改名换上：写到一半断电，留下的也是旧的那份
 * @param {string} file
 * @param {string} home
 */
export function writeLocation(file, home) {
  const path = /^([A-Za-z]:|\\\\)/.test(file) ? win32 : posix;
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ home }, null, 2)}\n`);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/**
 * 卸载时删掉定位文件：只删指着这个家目录的那份（Windows 上不分大小写）。坏了的不删，照实报
 * @returns {boolean} 删了没有
 */
export function forgetLocation(file, home, platform) {
  const recorded = readLocation(file, platform);
  if (recorded === null) return false;
  const same =
    platform === "win32"
      ? recorded.toLowerCase() === normalized(home, platform).toLowerCase()
      : recorded === normalized(home, platform);
  if (!same) return false;
  rmSync(file, { force: true });
  return true;
}
