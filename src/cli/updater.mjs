import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalizedError, msg } from "../i18n/index.mjs";

// 和下载地址打交道：问最新的是哪个版本，拿那边的安装脚本把它装上。
// 用 curl 而不是 Node 自己的 fetch：安装脚本也用它，终端里设的代理（https_proxy 这些）两边一样认。

/** 发布包放在这里，和 install.sh 里的 DOWNLOAD_URL 是同一个 */
export const DOWNLOAD_URL = "https://dl.zephyrxiang.com/speakmore";

/** 从哪下载。和安装脚本一样认 SPEAKMORE_INSTALL_BASE：一个网址前缀，或者本机的一个目录（npm run release 打出来的） */
export function downloadBase(env) {
  const base = env.SPEAKMORE_INSTALL_BASE || DOWNLOAD_URL;
  return base.startsWith("/") ? `file://${base}` : base;
}

/** curl 取一个地址。取不到时报出地址和 curl 自己说的原因 */
function curl(url, args) {
  return new Promise((resolve, reject) => {
    execFile("curl", ["-fsSL", ...args, url], { encoding: "utf8" }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const reason = stderr.trim() || error.message;
      reject(new LocalizedError(msg("cli.update.unreachable", { url, reason }), { cause: error }));
    });
  });
}

/**
 * @param {object} options
 * @param {Record<string, string | undefined>} options.env 安装脚本也在这个环境里跑（代理、SPEAKMORE_INSTALL_BASE 都传过去）
 * @param {string} options.home 装到哪：就是现在这一份所在的家目录
 */
export function createUpdater({ env, home }) {
  const base = downloadBase(env);
  return {
    /** 下载地址上标着最新的是哪个版本（原样，比如 v0.6.0）。@param {number} timeoutSeconds 最多等多久 */
    async latest(timeoutSeconds) {
      const text = await curl(`${base}/latest`, ["--max-time", String(timeoutSeconds)]);
      return text.split("\n")[0].trim();
    },

    /**
     * 用下载地址上的安装脚本装上这个版本。它会停掉正在运行的、换掉程序、再启动，说的话直接接到终端上。
     * 用那边的脚本而不是这一份带的：怎么装是新版本说了算
     * @returns {Promise<number>} 安装脚本的退出码
     */
    async install(version) {
      const dir = mkdtempSync(join(tmpdir(), "speakmore-update-"));
      try {
        const script = join(dir, "install.sh");
        await curl(`${base}/install.sh`, ["--max-time", "60", "-o", script]);
        return await new Promise((resolve, reject) => {
          const child = spawn("/bin/bash", [script], {
            stdio: "inherit",
            env: { ...env, SPEAKMORE_HOME: home, SPEAKMORE_VERSION: version },
          });
          child.on("error", reject);
          // 被信号打断时没有退出码，算没装成
          child.on("exit", (code) => resolve(code ?? 1));
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
