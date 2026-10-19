import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { runToEnd } from "./exec.mjs";
import { homePackage, versionDir } from "./layout.mjs";
import { parseVersion } from "./versions.mjs";

// 装在家目录里的那一份：安装脚本（install.sh、install.ps1）装的。Mac 上是终端安装，Windows 上两种安装都是它。
// 换成新版本用新版本自己的安装脚本（怎么装是新版本说了算）。先把安装脚本和包下到一个临时目录、摆成下载地址的样子，
// 再让安装脚本从那里装：下载在停掉正在运行的那个之前就做完了，停着的只有换程序的那十几秒，下载失败也什么都没动。

/** 一个程序目录里 package.json 写的版本；没有、读不出、不像版本号的是 null */
function versionIn(appDir) {
  try {
    return parseVersion(JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")).version);
  } catch {
    return null;
  }
}

/**
 * 家目录里装着的那一份的程序目录：Mac 是 app，Windows 是 current 指着的 versions 下那个版本里的 app。
 * 没装（或者 Windows 上 current 读不出来）是 null
 */
function homeAppDir(paths, platform) {
  if (platform !== "win32") return paths.appDir;
  try {
    const current = readFileSync(paths.currentFile, "utf8").trim();
    return current ? join(paths.versionsDir, current, "app") : null;
  } catch {
    return null;
  }
}

/**
 * 这一份程序是不是家目录里装的那一份：程序在家目录的 app 里（macOS），或者 versions 下某一个版本的 app 里
 * （Windows，不分大小写）。比真实的路径：家目录可能经过符号链接（/tmp 其实是 /private/tmp），
 * 而程序算出来的自己在哪是真实的路径
 */
export function isHomeCopy(packageDir, paths, platform) {
  try {
    const program = realpathSync(packageDir);
    if (platform !== "win32") return program === realpathSync(paths.appDir);
    const versions = realpathSync(paths.versionsDir).toLowerCase();
    return basename(program).toLowerCase() === "app" && dirname(dirname(program)).toLowerCase() === versions;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * 安装脚本按什么芯片取包：Apple 芯片上即使这个进程跑在转译里，install.sh 也装 arm64 的（它看 sysctl.proc_translated）
 * @returns {"arm64" | "x64"}
 */
export function homeArch(platform, arch, translated = () => sysctlTranslated()) {
  if (platform === "win32" || arch === "arm64") return arch === "arm64" ? "arm64" : "x64";
  return translated() ? "arm64" : "x64";
}

function sysctlTranslated() {
  try {
    return execFileSync("sysctl", ["-n", "sysctl.proc_translated"], { encoding: "utf8" }).trim() === "1";
  } catch {
    return false;
  }
}

/**
 * @param {object} options
 * @param {ReturnType<import("../storage/paths.mjs").resolvePaths>} options.paths
 * @param {Record<string, string | undefined>} options.env 安装脚本也在这个环境里跑（代理这些传过去）
 * @param {ReturnType<import("./release.mjs").createRelease>} options.release
 * @param {"inherit" | ["ignore", number, number]} options.stdio 安装脚本和启动时说的话接到哪：终端，或者日志
 */
export function createHomes({
  paths,
  env,
  release,
  stdio,
  platform = process.platform,
  arch = process.arch,
  translated,
}) {
  const windows = platform === "win32";
  return {
    /** 家目录里装着的那一份是哪个版本；没装是 null */
    find() {
      const appDir = homeAppDir(paths, platform);
      const version = appDir ? versionIn(appDir) : null;
      return version ? { version } : null;
    },

    /**
     * 把这个版本的安装脚本和包（连同校验值）下到一个临时目录，摆成下载地址的样子，核对好校验值
     * @param {string} version 不带 v
     * @returns {Promise<{ dir: string, discard: () => void }>}
     */
    async stage(version) {
      const { archive, script } = homePackage(platform, homeArch(platform, arch, translated));
      const dir = mkdtempSync(join(tmpdir(), "speakmore-update-"));
      const discard = () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      try {
        mkdirSync(join(dir, versionDir(version)));
        await release.fetch(script, join(dir, script));
        await release.fetchVerified(`${versionDir(version)}/${archive}`, join(dir, versionDir(version), archive));
        // 安装脚本指定了版本就不问 latest；照样写上，和下载地址一模一样
        writeFileSync(join(dir, "latest"), `${versionDir(version)}\n`);
      } catch (error) {
        discard();
        throw error;
      }
      return { dir, discard };
    },

    /**
     * 让下好的安装脚本从临时目录装上这个版本，只装不启动（谁原来在跑、装完重新打开谁，由更新那一层管）。
     * 它说的话照 stdio 接
     * @returns {Promise<number>} 安装脚本的退出码
     */
    install(staged, version) {
      const installerEnv = {
        ...env,
        SPEAKMORE_HOME: paths.home,
        SPEAKMORE_VERSION: versionDir(version),
        SPEAKMORE_INSTALL_BASE: staged.dir,
      };
      // 它自己用装好的那份 Electron 当 Node 跑命令，不要把这边的带过去
      delete installerEnv.ELECTRON_RUN_AS_NODE;
      if (windows) {
        // install.ps1 从 irm | iex 跑时传不了参数，只认环境变量。按 UTF-8 读进来再当脚本块跑：存成文件直接 -File 的话，
        // 5.1 把没有 BOM 的脚本当成系统编码（GBK）读；也绕开了执行策略（只允许跑文件这一层管着的那种）
        installerEnv.SPEAKMORE_NO_START = "1";
        installerEnv.SPEAKMORE_INSTALL_SCRIPT = join(staged.dir, "install.ps1");
        const command =
          "& ([scriptblock]::Create([IO.File]::ReadAllText($env:SPEAKMORE_INSTALL_SCRIPT, [Text.Encoding]::UTF8))); exit $LASTEXITCODE";
        return runToEnd("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
          env: installerEnv,
          stdio,
        });
      }
      return runToEnd("/bin/bash", [join(staged.dir, "install.sh"), "--no-start"], { env: installerEnv, stdio });
    },

    /**
     * 启动家目录里的这一份（装好的 speakmore 命令的 start）：和装完以后在终端里敲 speakmore 是一回事
     * @returns {Promise<number>} 退出码
     */
    start() {
      const { ELECTRON_RUN_AS_NODE: _asNode, ...startEnv } = env;
      startEnv.SPEAKMORE_HOME = paths.home;
      if (windows) {
        // .cmd 要经 cmd 才跑得起来；路径里可能有空格，整个用引号括起来
        return runToEnd(`"${join(paths.binDir, "speakmore.cmd")}"`, ["start"], {
          env: startEnv,
          stdio,
          shell: true,
        });
      }
      return runToEnd(join(paths.binDir, "speakmore"), ["start"], { env: startEnv, stdio });
    },
  };
}
