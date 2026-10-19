import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { basename } from "node:path";
import { LocalizedError, msg } from "../i18n/index.mjs";
import { run } from "./exec.mjs";

// 和下载地址打交道：问最新的是哪个版本，把一个文件下到本机、按发布的校验值核对。
// 用 curl 而不是 Node 自己的 fetch：安装脚本也用它，终端里设的代理（https_proxy 这些）两边一样认。
// Windows 10 起自带 curl.exe。

/** 发布包放在这里，和 install.sh 里的 DOWNLOAD_URL 是同一个 */
export const DOWNLOAD_URL = "https://dl.zephyrxiang.com/speakmore";

/** 从哪下载。和安装脚本一样认 SPEAKMORE_INSTALL_BASE：一个网址前缀，或者本机的一个目录（npm run release 打出来的） */
export function downloadBase(env) {
  const base = env.SPEAKMORE_INSTALL_BASE || DOWNLOAD_URL;
  if (base.startsWith("/")) return `file://${base}`;
  // Windows 的盘符路径：C:\dist\release → file:///C:/dist/release
  if (/^[A-Za-z]:[\\/]/.test(base)) return `file:///${base.replaceAll("\\", "/")}`;
  return base;
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

/**
 * @param {object} options
 * @param {Record<string, string | undefined>} options.env 代理、SPEAKMORE_INSTALL_BASE 从这里认
 * @param {boolean} [options.progress] 下载大文件时把 curl 的进度条接到终端上（命令行在终端里时）
 */
export function createRelease({ env, progress = false }) {
  const base = downloadBase(env);

  /** 下载一个文件。在终端里时显示进度条：安装包一两百兆，不能一声不吭等着 */
  function download(path, file, { showProgress = progress } = {}) {
    const url = `${base}/${path}`;
    return new Promise((resolve, reject) => {
      const args = ["-fL", showProgress ? "--progress-bar" : "-sS", "--max-time", "1800", "-o", file, url];
      const child = spawn("curl", args, {
        stdio: ["ignore", "ignore", showProgress ? "inherit" : "pipe"],
        env,
        windowsHide: true,
      });
      let said = "";
      child.stderr?.on("data", (chunk) => {
        said += chunk;
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) return resolve();
        const reason = said.trim() || `curl exit ${code}`;
        reject(new LocalizedError(msg("update.unreachable", { url, reason })));
      });
    });
  }

  return {
    /** 下载地址上某个文件的网址：自己换不了时告诉用户去哪下 */
    url: (path) => `${base}/${path}`,

    /** 下载地址上标着最新的是哪个版本（原样，比如 v0.6.0）。@param {number} timeoutSeconds 最多等多久 */
    async latest(timeoutSeconds) {
      const url = `${base}/latest`;
      try {
        const text = await run("curl", ["-fsSL", "--max-time", String(timeoutSeconds), url], { env });
        return text.split("\n")[0].trim();
      } catch (error) {
        throw new LocalizedError(msg("update.unreachable", { url, reason: error.said }), { cause: error });
      }
    },

    /** 下载一个不带校验值的小文件（安装脚本） */
    fetch: (path, file) => download(path, file, { showProgress: false }),

    /**
     * 下载一个包和它的 .sha256，核对两者对得上。对不上多半是路上坏了，抛出说是哪个文件
     * （校验值和包放在同一个地方，只防得住路上坏了；Mac 的安装包另外核对签名，见 bundle.mjs）
     */
    async fetchVerified(path, file) {
      await download(path, file);
      await download(`${path}.sha256`, `${file}.sha256`, { showProgress: false });
      const expected = readFileSync(`${file}.sha256`, "utf8").split(/\s/)[0];
      if (expected !== (await sha256Of(file))) {
        throw new LocalizedError(msg("update.checksum", { file: basename(file) }));
      }
    },
  };
}
