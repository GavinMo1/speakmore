import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { LocalizedError, msg } from "../i18n/index.mjs";

// SpeakMore 的家：程序、运行环境、设置、key、历史、录音、日志，全在这一个目录里。
// 装的时候往里放，删的时候删掉它就干净了。命令行和后台应用是两个进程，靠这一份约定找到同一批文件。
//
//   ~/.speakmore/
//     bin/ app/ runtime/           程序本身：安装时放进去，升级时整个换掉
//     settings.json <厂商>-key.bin data/    你的东西（每家模型一把 key：gemini-key.bin、openai-key.bin）
//     logs/ run/ cache/            运行时产生的，删了会自己再建

/** macOS 上 Unix 套接字的路径最长 103 个字节（sockaddr_un.sun_path 是 104，含结尾的 0） */
const MAX_SOCKET_PATH_BYTES = 103;

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} userHome 用户的家目录，测试时换掉
 */
export function resolvePaths(env = process.env, userHome = homedir()) {
  // SPEAKMORE_HOME：把整个目录换到别处。测试用它指到临时目录，不碰真实的历史
  const home = env.SPEAKMORE_HOME || join(userHome, ".speakmore");
  // 相对路径会随着"在哪个目录运行命令"而变：换个目录就找不到正在运行的那个，还会再起一个
  if (!isAbsolute(home)) {
    throw new LocalizedError(msg("paths.homeNotAbsolute", { home: JSON.stringify(home) }));
  }
  const controlSocket = join(home, "run", "control.sock");
  if (Buffer.byteLength(controlSocket) > MAX_SOCKET_PATH_BYTES) {
    throw new LocalizedError(msg("paths.homeTooLong", { home }));
  }
  return {
    home,

    /** speakmore 命令（一个启动脚本）。PATH 里的那个是指向它的链接 */
    binDir: join(home, "bin"),
    /** 安装时在家目录以外建了哪些指向这条命令的链接，一行一个。卸载时照着删 */
    linksFile: join(home, "bin", "links"),
    /** 程序的代码和依赖 */
    appDir: join(home, "app"),
    /** 运行环境：自带的 Electron，命令行和后台应用都用它跑 */
    runtimeDir: join(home, "runtime"),

    settingsFile: join(home, "settings.json"),
    historyDb: join(home, "data", "history.db"),
    recordingsDir: join(home, "data", "Recordings"),

    logFile: join(home, "logs", "main.log"),
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
 * 某一家模型的 key 加密后存在哪。0.3 以前只有 Gemini，文件就叫 gemini-key.bin，所以这个命名不用迁移。
 * 加密用的密钥在钥匙串里是按应用存的：命令启动的和打成应用的是两个应用，互相解不开对方的密文，所以各存各的文件。
 * @param {ReturnType<typeof resolvePaths>} paths
 * @param {string} provider 厂商的 id（providers/index.mjs）
 * @param {{ packaged?: boolean }} [options] packaged：打成 .app 的那一个用的
 */
export function keyFile(paths, provider, { packaged = false } = {}) {
  // id 来自我们自己的清单；还是防一手，免得拼出家目录以外的路径
  if (!/^[a-z0-9]+$/.test(provider)) throw new Error(`厂商的 id 不对：${JSON.stringify(provider)}`);
  return join(paths.home, `${provider}-key${packaged ? ".app" : ""}.bin`);
}

/**
 * 把家目录建出来。里面有录音和 key，所以只有自己进得去。
 * @param {ReturnType<typeof resolvePaths>} paths
 */
export function ensureHome(paths) {
  mkdirSync(paths.home, { recursive: true, mode: 0o700 });
  // 目录早就在的话 mkdir 不会改它的权限
  chmodSync(paths.home, 0o700);
  mkdirSync(dirname(paths.controlSocket), { recursive: true });
}

/** 0.1 版把数据放在这里。现在只在第一次运行时用来把旧数据搬过来（见 legacy.mjs） */
export function legacyDataDir(userHome = homedir()) {
  return join(userHome, "Library", "Application Support", "SpeakMore");
}
