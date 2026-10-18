import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { LocalizedError, msg } from "../i18n/index.mjs";
import { removeAfterExit } from "./windows-system.mjs";

// 和下载地址打交道：问最新的是哪个版本，拿那边的安装脚本把它装上；装着 SpeakMore.app 的，下载新的安装包把它换掉。
// 用 curl 而不是 Node 自己的 fetch：安装脚本也用它，终端里设的代理（https_proxy 这些）两边一样认。
// Windows 10 起自带 curl.exe。Windows 上的安装脚本是 install.ps1，也没有单独的 App 要换。

const WINDOWS = process.platform === "win32";

/** 发布包放在这里，和 install.sh 里的 DOWNLOAD_URL 是同一个 */
export const DOWNLOAD_URL = "https://dl.zephyrxiang.com/speakmore";

/** 打包时写进 App 的应用标识（scripts/build/mac-app.mjs）：名字叫 SpeakMore.app 的不一定是我们的 */
const APP_BUNDLE_ID = "com.zephyrxiang.speakmore";
const APP_NAME = "SpeakMore.app";

/** 从哪下载。和安装脚本一样认 SPEAKMORE_INSTALL_BASE：一个网址前缀，或者本机的一个目录（npm run release 打出来的） */
export function downloadBase(env) {
  const base = env.SPEAKMORE_INSTALL_BASE || DOWNLOAD_URL;
  if (base.startsWith("/")) return `file://${base}`;
  // Windows 的盘符路径：C:\dist\release → file:///C:/dist/release
  if (/^[A-Za-z]:[\\/]/.test(base)) return `file:///${base.replaceAll("\\", "/")}`;
  return base;
}

/**
 * 在 Windows 上跑下载来的 install.ps1。按 UTF-8 读进来再当脚本块跑：存成文件直接 -File 的话，
 * 5.1 把没有 BOM 的脚本当成系统编码（GBK）读；也绕开了执行策略（只允许跑文件这一层管着的那种）
 */
const RUN_INSTALL_PS1 =
  "& ([scriptblock]::Create([IO.File]::ReadAllText($env:SPEAKMORE_INSTALL_SCRIPT, [Text.Encoding]::UTF8))); exit $LASTEXITCODE";

/**
 * 删掉放安装脚本的临时目录。Windows 上杀毒软件刚扫完的脚本可能还开着、一时删不掉：这时交给后台等这条命令退出后再删，
 * 不把它当成失败（安装已经做完了，结果以安装脚本的退出码为准）
 */
function removeTempDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    if (!WINDOWS || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    removeAfterExit([dir]);
  }
}

/** 跑一条命令，交出标准输出。失败时连同它在标准错误里说的一起抛出 */
function run(command, args, { env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", env }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      error.said = stderr.trim() || error.message;
      reject(error);
    });
  });
}

/** curl 取一个地址。取不到时报出地址和 curl 自己说的原因 */
async function curl(url, args) {
  try {
    return await run("curl", ["-fsSL", ...args, url]);
  } catch (error) {
    throw new LocalizedError(msg("cli.update.unreachable", { url, reason: error.said }), { cause: error });
  }
}

/** 下载一个大文件。在终端里时把 curl 的进度条接到终端上：安装包一百多兆，不能一声不吭等着 */
function download(url, file, { progress }) {
  return new Promise((resolve, reject) => {
    const args = ["-fL", progress ? "--progress-bar" : "-sS", "--max-time", "1800", "-o", file, url];
    const child = spawn("curl", args, { stdio: ["ignore", "ignore", progress ? "inherit" : "pipe"] });
    let said = "";
    child.stderr?.on("data", (chunk) => {
      said += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      const reason = said.trim() || `curl exit ${code}`;
      reject(new LocalizedError(msg("cli.update.unreachable", { url, reason })));
    });
  });
}

function sha256Of(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** 一个应用包的应用标识和版本号；不是应用包（不存在、没有 Info.plist）是 null */
async function bundleInfo(app) {
  const plist = join(app, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  const read = async (key) => (await run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist])).trim();
  try {
    return { id: await read("CFBundleIdentifier"), version: await read("CFBundleShortVersionString") };
  } catch {
    return null;
  }
}

/** 正在跑的那个进程的程序在哪个应用包里（…/SpeakMore.app/Contents/MacOS/SpeakMore → …/SpeakMore.app） */
async function bundleOfProcess(pid) {
  let executable;
  try {
    executable = (await run("ps", ["-o", "comm=", "-p", String(pid)])).trim();
  } catch {
    // 进程刚好退出了：当没在跑
    return null;
  }
  const at = executable.indexOf(".app/Contents/MacOS/");
  return at === -1 ? null : executable.slice(0, at + ".app".length);
}

/** 下载来的应用包签名完好：每个文件都和签名对得上 */
async function verifySignature(app) {
  try {
    await run("codesign", ["--verify", "--deep", "--strict", app]);
  } catch (error) {
    throw new LocalizedError(msg("cli.update.appUnsigned", { reason: error.said }), { cause: error });
  }
}

/** 签名的开发者编号。临时签名的是 "not set"，没签名的是 null */
async function teamOf(app) {
  // codesign -d 把说明写在标准错误里；没签名时它报错退出，说明里也就没有这一行
  const described = await new Promise((resolve) => {
    execFile("codesign", ["-dv", app], { encoding: "utf8" }, (_error, _stdout, stderr) => resolve(stderr));
  });
  return /^TeamIdentifier=(.*)$/m.exec(described)?.[1] ?? null;
}

/**
 * @param {object} options
 * @param {Record<string, string | undefined>} options.env 安装脚本也在这个环境里跑（代理、SPEAKMORE_INSTALL_BASE 都传过去）
 * @param {string} options.home 装到哪：就是现在这一份所在的家目录
 * @param {boolean} [options.progress] 下载安装包时显示进度条
 */
export function createUpdater({ env, home, progress = false }) {
  const base = downloadBase(env);
  return {
    /** 下载地址上标着最新的是哪个版本（原样，比如 v0.6.0）。@param {number} timeoutSeconds 最多等多久 */
    async latest(timeoutSeconds) {
      const text = await curl(`${base}/latest`, ["--max-time", String(timeoutSeconds)]);
      return text.split("\n")[0].trim();
    },

    /**
     * 用下载地址上的安装脚本装上这个版本。它会停掉正在运行的、换掉程序，说的话直接接到终端上。
     * 用那边的脚本而不是这一份带的：怎么装是新版本说了算
     * @param {{ start?: boolean }} [options] start 为 false 时只装不启动（--no-start）
     * @returns {Promise<number>} 安装脚本的退出码
     */
    async install(version, { start = true } = {}) {
      const dir = mkdtempSync(join(tmpdir(), "speakmore-update-"));
      try {
        const script = join(dir, WINDOWS ? "install.ps1" : "install.sh");
        await curl(`${base}/${WINDOWS ? "install.ps1" : "install.sh"}`, ["--max-time", "60", "-o", script]);
        const installerEnv = { ...env, SPEAKMORE_HOME: home, SPEAKMORE_VERSION: version };
        const [command, args] = WINDOWS
          ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", RUN_INSTALL_PS1]]
          : ["/bin/bash", [script, ...(start ? [] : ["--no-start"])]];
        if (WINDOWS) {
          installerEnv.SPEAKMORE_INSTALL_SCRIPT = script;
          // install.ps1 从 irm | iex 跑时传不了参数，只认环境变量
          if (!start) installerEnv.SPEAKMORE_NO_START = "1";
          // 它自己用装好的那份 Electron 当 Node 跑命令，不要把这边的带过去
          delete installerEnv.ELECTRON_RUN_AS_NODE;
        }
        const code = await new Promise((resolve, reject) => {
          const child = spawn(command, args, { stdio: "inherit", env: installerEnv });
          child.on("error", reject);
          // 被信号打断时没有退出码，算没装成
          child.on("exit", (exitCode) => resolve(exitCode ?? 1));
        });
        // Windows 上这条命令自己就跑在换下来的那个版本上：install.ps1 看见它还在用着，等它退出后自己删
        return code;
      } finally {
        removeTempDir(dir);
      }
    },

    /**
     * 装着的 SpeakMore.app 在哪、是哪个版本。先看 SPEAKMORE_APP 指的；再看正在跑的那个（用户可能没放在"应用程序"里）；
     * 再看两个"应用程序"文件夹
     * @param {number | null} pid 正在跑的 App 的进程号；跑的不是 App 时是 null
     * @returns {Promise<{ path: string, version: string } | null>}
     */
    async findApp(pid) {
      // Windows 上没有单独的 App：开始菜单起的就是命令行装的这一份
      if (WINDOWS) return null;
      const candidates = env.SPEAKMORE_APP
        ? [env.SPEAKMORE_APP]
        : [
            pid === null ? null : await bundleOfProcess(pid),
            join("/Applications", APP_NAME),
            join(env.HOME || homedir(), "Applications", APP_NAME),
          ];
      for (const path of candidates) {
        if (path === null) continue;
        const info = await bundleInfo(path);
        if (info?.id === APP_BUNDLE_ID) return { path, version: info.version };
      }
      return null;
    },

    /**
     * 下载这个版本的安装包，把 app 这个位置上的 SpeakMore.app 换成里面那个。
     * 先核对：校验值和发布的一样、里面确实是这个版本的 SpeakMore、签名完好，而且和装着的出自同一个开发者
     * （校验值和安装包放在同一个地方，只防得住路上坏了；同一个开发者才防得住被人换了）。
     * 换的时候新的先拷到旁边，再两次改名对调：换到一半出了错，装着的那个原样留着。调用前要先让 App 退出
     */
    async installApp(version, app) {
      const arch = process.arch === "arm64" ? "arm64" : "x64";
      const name = `SpeakMore-${arch}.dmg`;
      const url = `${base}/${version}/${name}`;
      const dir = mkdtempSync(join(tmpdir(), "speakmore-app-update-"));
      const mountpoint = join(dir, "mnt");
      let mounted = false;
      // 新旧两个都放在 App 旁边：同一个磁盘上改名是一步到位的。名字带点开头，访达里看不见
      const staged = join(dirname(app), `.${basename(app)}.new`);
      const old = join(dirname(app), `.${basename(app)}.old`);
      const cannotReplace = (error, reason = error.message) =>
        new LocalizedError(msg("cli.update.appReplace", { path: app, reason, url }), { cause: error });
      try {
        const dmg = join(dir, name);
        await download(url, dmg, { progress });
        await download(`${url}.sha256`, `${dmg}.sha256`, { progress: false });
        const expected = readFileSync(`${dmg}.sha256`, "utf8").split(/\s/)[0];
        if (expected !== (await sha256Of(dmg))) throw new LocalizedError(msg("cli.update.appChecksum", { file: name }));

        mkdirSync(mountpoint);
        try {
          await run("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mountpoint, dmg]);
        } catch (error) {
          throw new LocalizedError(msg("cli.update.appMount", { file: name, reason: error.said }), { cause: error });
        }
        mounted = true;
        const source = join(mountpoint, APP_NAME);
        const wanted = version.replace(/^v/, "");
        const info = await bundleInfo(source);
        if (info?.id !== APP_BUNDLE_ID || info.version !== wanted) {
          throw new LocalizedError(msg("cli.update.appWrongPackage", { file: name, version: wanted }));
        }
        await verifySignature(source);
        const [incoming, current] = [await teamOf(source), await teamOf(app)];
        if (incoming !== current) {
          throw new LocalizedError(
            msg("cli.update.appOtherDeveloper", { found: incoming ?? "-", installed: current ?? "-" }),
          );
        }

        rmSync(staged, { recursive: true, force: true });
        rmSync(old, { recursive: true, force: true });
        try {
          // ditto 原样拷贝应用包，保留签名和里面的符号链接
          await run("ditto", [source, staged]);
        } catch (error) {
          throw cannotReplace(error, error.said);
        }
        try {
          renameSync(app, old);
        } catch (error) {
          throw cannotReplace(error);
        }
        try {
          renameSync(staged, app);
        } catch (error) {
          renameSync(old, app);
          throw cannotReplace(error);
        }
        rmSync(old, { recursive: true, force: true });
      } finally {
        rmSync(staged, { recursive: true, force: true });
        // 卸不下来时目录还挂着，不能连目录一起删（会去删只读盘上的文件）：强制卸，再不行就把错报出去
        if (mounted) {
          await run("hdiutil", ["detach", "-quiet", mountpoint]).catch(() =>
            run("hdiutil", ["detach", "-force", "-quiet", mountpoint]),
          );
        }
        rmSync(dir, { recursive: true, force: true });
      }
    },

    /**
     * 打开 App（换完之后把原来在跑的那个重新打开）。open 会把自己的环境变量交给打开的 App，
     * 而这个命令是借 Electron 当 Node 跑的（ELECTRON_RUN_AS_NODE=1）：带过去的话 App 也当成 Node 跑，一启动就退出。
     * 别的照样带过去，SPEAKMORE_HOME 这些和命令行这边一致
     */
    async openApp(app) {
      const { ELECTRON_RUN_AS_NODE: _asNode, ...appEnv } = env;
      await run("open", [app], { env: appEnv });
    },
  };
}
