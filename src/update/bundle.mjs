import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { LocalizedError, msg } from "../i18n/index.mjs";
import { run } from "./exec.mjs";
import { dmgName, versionDir } from "./layout.mjs";

// Mac 上的 SpeakMore.app（拖进"应用程序"的那个）：在哪、是哪个版本，换成新版本，重新打开。
// 换的时候先把新的下好、核对好、拷到它旁边（这时它还可以照常运行），等它退出了再两次改名对调：
// 换到一半出了错，装着的那个原样留着。Windows 上没有单独的应用包。

/** 打包时写进 App 的应用标识（scripts/build/mac-app.mjs）：名字叫 SpeakMore.app 的不一定是我们的 */
const APP_BUNDLE_ID = "com.zephyrxiang.speakmore";
const APP_NAME = "SpeakMore.app";

/** 一个应用包的应用标识和版本号；不是应用包（不存在、没有 Info.plist）是 null */
export async function bundleInfo(app) {
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

/** 程序目录在哪个应用包里（…/SpeakMore.app/Contents/Resources/app → …/SpeakMore.app）；不在应用包里是 null */
export function bundleOfPackage(packageDir) {
  const suffix = /\.app[\\/]Contents[\\/]Resources[\\/]app[\\/]?$/;
  const match = suffix.exec(packageDir);
  return match ? packageDir.slice(0, match.index + ".app".length) : null;
}

/** 下载来的应用包签名完好：每个文件都和签名对得上 */
async function verifySignature(app) {
  try {
    await run("codesign", ["--verify", "--deep", "--strict", app]);
  } catch (error) {
    throw new LocalizedError(msg("update.appUnsigned", { reason: error.said }), { cause: error });
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
 * @param {Record<string, string | undefined>} options.env SPEAKMORE_APP 指定 App 在哪（测试用）；打开 App 时交给它
 * @param {ReturnType<import("./release.mjs").createRelease>} options.release
 * @param {NodeJS.Platform} [options.platform]
 * @param {string} [options.arch] 下哪种芯片的安装包：和装着的这一份一样
 */
export function createBundles({ env, release, platform = process.platform, arch = process.arch }) {
  return {
    /**
     * 装着的 SpeakMore.app 在哪、是哪个版本。先看 SPEAKMORE_APP 指的；再看正在跑的那个、这份程序自己所在的那个
     * （用户可能没放在"应用程序"里）；再看两个"应用程序"文件夹
     * @param {{ pid?: number | null, self?: string | null }} [where] pid：正在跑的 App 的进程号；self：这份程序所在的应用包
     * @returns {Promise<{ path: string, version: string } | null>}
     */
    async find({ pid = null, self = null } = {}) {
      if (platform !== "darwin") return null;
      const candidates = env.SPEAKMORE_APP
        ? [env.SPEAKMORE_APP]
        : [
            pid === null ? null : await bundleOfProcess(pid),
            self,
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
     * 把这个版本的安装包下好、核对好，里面的 SpeakMore.app 拷到 app 旁边待换。这一步不碰装着的那个，它可以照常运行。
     * 核对的是：校验值和发布的一样、里面确实是这个版本的 SpeakMore、签名完好，而且和装着的出自同一个开发者
     * （校验值和安装包放在同一个地方，只防得住路上坏了；同一个开发者才防得住被人换了）
     * @param {string} version 不带 v
     * @param {string} app 装着的 App
     * @returns {Promise<{ commit: () => void, discard: () => void }>} commit 换上（调用前 App 要已经退出），discard 不换了、删掉待换的
     */
    async stage(version, app) {
      const name = dmgName(arch === "arm64" ? "arm64" : "x64");
      const path = `${versionDir(version)}/${name}`;
      const dir = mkdtempSync(join(tmpdir(), "speakmore-app-update-"));
      const mountpoint = join(dir, "mnt");
      let mounted = false;
      // 新旧两个都放在 App 旁边：同一个磁盘上改名是一步到位的。名字带点开头，访达里看不见
      const staged = join(dirname(app), `.${basename(app)}.new`);
      const old = join(dirname(app), `.${basename(app)}.old`);
      const cannotReplace = (error, reason = error.message) =>
        new LocalizedError(msg("update.appReplace", { path: app, reason, url: release.url(path) }), { cause: error });
      try {
        const dmg = join(dir, name);
        await release.fetchVerified(path, dmg);
        mkdirSync(mountpoint);
        try {
          await run("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mountpoint, dmg]);
        } catch (error) {
          throw new LocalizedError(msg("update.appMount", { file: name, reason: error.said }), { cause: error });
        }
        mounted = true;
        const source = join(mountpoint, APP_NAME);
        const info = await bundleInfo(source);
        if (info?.id !== APP_BUNDLE_ID || info.version !== version) {
          throw new LocalizedError(msg("update.appWrongPackage", { file: name, version }));
        }
        await verifySignature(source);
        const [incoming, current] = [await teamOf(source), await teamOf(app)];
        if (incoming !== current) {
          throw new LocalizedError(
            msg("update.appOtherDeveloper", { found: incoming ?? "-", installed: current ?? "-" }),
          );
        }
        rmSync(staged, { recursive: true, force: true });
        try {
          // ditto 原样拷贝应用包，保留签名和里面的符号链接
          await run("ditto", [source, staged]);
        } catch (error) {
          rmSync(staged, { recursive: true, force: true });
          throw cannotReplace(error, error.said);
        }
      } finally {
        // 卸不下来时目录还挂着，不能连目录一起删（会去删只读盘上的文件）：强制卸，再不行就把错报出去
        if (mounted) {
          await run("hdiutil", ["detach", "-quiet", mountpoint]).catch(() =>
            run("hdiutil", ["detach", "-force", "-quiet", mountpoint]),
          );
        }
        rmSync(dir, { recursive: true, force: true });
      }

      return {
        commit() {
          rmSync(old, { recursive: true, force: true });
          try {
            renameSync(app, old);
          } catch (error) {
            rmSync(staged, { recursive: true, force: true });
            throw cannotReplace(error);
          }
          try {
            renameSync(staged, app);
          } catch (error) {
            renameSync(old, app);
            rmSync(staged, { recursive: true, force: true });
            throw cannotReplace(error);
          }
          rmSync(old, { recursive: true, force: true });
        },
        discard() {
          rmSync(staged, { recursive: true, force: true });
        },
      };
    },

    /**
     * 打开 App（换完之后把原来在跑的那个重新打开）。open 会把自己的环境变量交给打开的 App，
     * 而更新是借 Electron 当 Node 跑的（ELECTRON_RUN_AS_NODE=1）：带过去的话 App 也当成 Node 跑，一启动就退出。
     * 别的照样带过去，SPEAKMORE_HOME 这些和这边一致
     */
    async open(app) {
      const { ELECTRON_RUN_AS_NODE: _asNode, ...appEnv } = env;
      await run("open", [app], { env: appEnv });
    },
  };
}
