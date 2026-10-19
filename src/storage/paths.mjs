import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { LocalizedError, msg } from "../i18n/index.mjs";
import { restrictToOwner } from "./owner-only.mjs";

// SpeakMore 的家：程序、运行环境、设置、key、历史、录音、日志，全在这一个目录里。
// 装的时候往里放，删的时候删掉它就干净了。命令行和后台应用是两个进程，靠这一份约定找到同一批文件。
//
//   ~/.speakmore/
//     bin/ app/ runtime/           程序本身：安装时放进去，升级时整个换掉（macOS）
//     bin\ versions\ current       Windows：每个版本装进 versions 下自己的目录，current 记着现在用哪个
//     settings.json vocabulary.json <厂商>-key.bin data/    你的东西（词典；每家模型一把 key：gemini-key.bin、openai-key.bin）
//     models/                      本地转写用的模型：用到时自动下载，删了下次用时再下
//     logs/ run/ cache/            运行时产生的，删了会自己再建
//
// Windows 上也是这一个目录（%USERPROFILE%\.speakmore），只有控制通道不在里面：那里用的是 named pipe，
// 名字在系统的 \\.\pipe\ 下，按家目录取，不在磁盘上留任何东西。

/** macOS 上 Unix 套接字的路径最长 103 个字节（sockaddr_un.sun_path 是 104，含结尾的 0） */
const MAX_SOCKET_PATH_BYTES = 103;

/**
 * 控制通道在哪。macOS 是 run/ 下的一个 Unix 套接字；Windows 没有放在目录里的套接字，用 named pipe，
 * 名字带上家目录的指纹：两个家目录（比如测试用的临时目录）各有各的，同一个家目录命令行和后台找到的是同一个。
 * Windows 的路径不分大小写，算指纹前统一成小写
 */
function controlEndpoint(home, path, platform) {
  if (platform !== "win32") return path.join(home, "run", "control.sock");
  const id = createHash("sha256").update(home.toLowerCase()).digest("hex").slice(0, 16);
  return `\\\\.\\pipe\\speakmore-${id}`;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} userHome 用户的家目录，测试时换掉
 * @param {NodeJS.Platform} platform 按哪个系统的写法拼路径，测试时换掉
 */
export function resolvePaths(env = process.env, userHome = homedir(), platform = process.platform) {
  const path = platform === "win32" ? win32 : posix;
  const join = path.join;
  // SPEAKMORE_HOME：把整个目录换到别处。测试用它指到临时目录，不碰真实的历史
  const home = env.SPEAKMORE_HOME || join(userHome, ".speakmore");
  // 相对路径会随着"在哪个目录运行命令"而变：换个目录就找不到正在运行的那个，还会再起一个
  if (!path.isAbsolute(home)) {
    throw new LocalizedError(msg("paths.homeNotAbsolute", { home: JSON.stringify(home) }));
  }
  const controlSocket = controlEndpoint(home, path, platform);
  if (platform !== "win32" && Buffer.byteLength(controlSocket) > MAX_SOCKET_PATH_BYTES) {
    throw new LocalizedError(msg("paths.homeTooLong", { home }));
  }
  return {
    home,

    /** speakmore 命令（一个启动脚本）。PATH 里的那个是指向它的链接 */
    binDir: join(home, "bin"),
    /** 安装时在家目录以外建了哪些指向这条命令的链接，一行一个。卸载时照着删 */
    linksFile: join(home, "bin", "links"),
    /** 程序的代码和依赖（macOS；Windows 上 0.9.2 及以前也在这里，之后在 versionsDir 下） */
    appDir: join(home, "app"),
    /** 运行环境：自带的 Electron，命令行和后台应用都用它跑（同上） */
    runtimeDir: join(home, "runtime"),
    /**
     * Windows：每个版本一个目录（<版本>-<编号>，里面是 app 和 runtime），install.ps1 装新版时解进一个新目录，
     * 不挪、不覆盖已有的文件（刚解出来的文件杀毒软件正扫着，挪不动；正在跑的那份占着自己的目录）
     */
    versionsDir: join(home, "versions"),
    /** Windows：现在用 versions 里的哪一个，一行目录名。bin\speakmore.cmd 照它找程序，装好新版时改它切过去 */
    currentFile: join(home, "current"),

    settingsFile: join(home, "settings.json"),
    /** 用户的词典（storage/vocabulary.mjs）：只存在本机 */
    vocabularyFile: join(home, "vocabulary.json"),
    historyDb: join(home, "data", "history.db"),
    recordingsDir: join(home, "data", "Recordings"),
    /** 本地转写的模型，一个模型一个目录（models/store.mjs） */
    modelsDir: join(home, "models"),

    logFile: join(home, "logs", "main.log"),
    /** 运行时的小文件（进程号、上次查更新的结果）；macOS 上控制通道的套接字也在这里 */
    runDir: join(home, "run"),
    /** 命令行和后台之间的控制通道：macOS 上是套接字文件的路径，Windows 上是 named pipe 的名字 */
    controlSocket,
    /** 正在运行的后台应用的进程号。只在它卡住不答话、要强行结束时才用得上 */
    pidFile: join(home, "run", "daemon.pid"),
    /** 上一次问下载地址最新版本的时间和结果。status 靠它一天只问一次 */
    updateCheckFile: join(home, "run", "update-check.json"),
    /** 运行环境（Chromium）自己的缓存和状态，和我们的数据分开放。停掉之后可以随时删 */
    cacheDir: join(home, "cache"),
  };
}

/**
 * Windows 上装好的那一份在哪个家目录里：程序是 <家目录>\versions\<版本>\runtime\electron.exe，旁边有 app。
 * 从开始菜单、开机启动起的没有 SPEAKMORE_HOME（只有 speakmore 命令会设），装在别处时靠这个找回家目录。
 * 不是这种摆法（从源码跑的、macOS）是 null
 * @param {string} execPath 正在跑的可执行文件
 * @param {(path: string) => boolean} exists
 */
export function installedHomeOf(execPath, exists) {
  const path = win32;
  if (path.basename(execPath).toLowerCase() !== "electron.exe") return null;
  const runtime = path.dirname(execPath);
  if (path.basename(runtime).toLowerCase() !== "runtime") return null;
  const version = path.dirname(runtime);
  const versions = path.dirname(version);
  if (path.basename(versions).toLowerCase() !== "versions") return null;
  return exists(path.join(version, "app", "package.json")) ? path.dirname(versions) : null;
}

/**
 * 某一家模型的 key 加密后存在哪。0.3 以前只有 Gemini，文件就叫 gemini-key.bin，所以这个命名不用迁移。
 * App 和命令行启动的后台共用这一个文件：加密用的密钥在钥匙串里只有一条（"SpeakMore Safe Storage"），两边都在它的
 * 访问名单上，解得开对方存的密文（2026-10-16 实测）。0.7.0 及以前以为两边互相解不开，App 另存一份（oldAppKeyFile）。
 * @param {ReturnType<typeof resolvePaths>} paths
 * @param {string} provider 厂商的 id（providers/index.mjs）
 */
export function keyFile(paths, provider) {
  return pathModuleOf(paths).join(paths.home, `${checkedVendorId(provider)}-key.bin`);
}

/** 0.7.0 及以前 App 自己那一份 key。只读来搬进共用的文件（app-keys.mjs），忘掉 key 时一起删 */
export function oldAppKeyFile(paths, provider) {
  return pathModuleOf(paths).join(paths.home, `${checkedVendorId(provider)}-key.app.bin`);
}

/** 拼家目录里的路径用哪一套写法：和 resolvePaths 拼出来的一致（盘符或 \\ 开头的是 Windows 的） */
const pathModuleOf = (paths) => (/^([A-Za-z]:|\\\\)/.test(paths.home) ? win32 : posix);

/** id 来自我们自己的清单；还是防一手，免得拼出家目录以外的路径 */
function checkedVendorId(provider) {
  if (!/^[a-z0-9]+$/.test(provider)) throw new Error(`厂商的 id 不对：${JSON.stringify(provider)}`);
  return provider;
}

/**
 * 把家目录建出来。里面有录音和 key，所以只有自己进得去。
 * @param {ReturnType<typeof resolvePaths>} paths
 */
export function ensureHome(paths, { restrict = restrictToOwner } = {}) {
  mkdirSync(paths.home, { recursive: true, mode: 0o700 });
  // 目录早就在的话 mkdir 不会改它的权限；Windows 上 mode 不起作用，靠这一步
  restrict(paths.home);
  mkdirSync(paths.runDir, { recursive: true });
}

/**
 * 0.1 版把数据放在这里。现在只在第一次运行时用来把旧数据搬过来（见 legacy.mjs）。
 * 0.1 只有 macOS 版，别的系统上没有旧数据，是 null
 */
export function legacyDataDir(userHome = homedir(), platform = process.platform) {
  return platform === "darwin" ? posix.join(userHome, "Library", "Application Support", "SpeakMore") : null;
}
