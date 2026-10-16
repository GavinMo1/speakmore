import { chmodSync, copyFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { keyFile, oldAppKeyFile } from "./paths.mjs";

// 0.7.0 及以前 App 和命令行各存一份 key（App 的是 <厂商>-key.app.bin）。0.7.1 起两边共用 <厂商>-key.bin，
// 启动时把 App 那一份搬过来：共用的还没有就抄一份；两份不一样就留后存的那份（多半是用户最近一次填的）。
// App 那一份原样留着：退回 0.7.0 时它照旧能用；忘掉 key 时一起删（key-store.mjs 的 clear），免得下次又被搬回来。

const OLD_APP_KEY = /^([a-z0-9]+)-key\.app\.bin$/;

/**
 * @param {object} options
 * @param {ReturnType<import("./paths.mjs").resolvePaths>} options.paths
 * @param {{ info: Function }} options.log
 */
export function adoptAppKeys({ paths, log }) {
  if (!existsSync(paths.home)) return;
  for (const name of readdirSync(paths.home)) {
    const provider = OLD_APP_KEY.exec(name)?.[1];
    if (!provider) continue;
    const old = oldAppKeyFile(paths, provider);
    const shared = keyFile(paths, provider);
    if (!existsSync(shared)) {
      adopt(old, shared);
      log.info("key_adopted", { provider });
      continue;
    }
    if (readFileSync(old).equals(readFileSync(shared))) continue;
    const appIsNewer = statSync(old).mtimeMs > statSync(shared).mtimeMs;
    if (appIsNewer) adopt(old, shared);
    log.info("key_conflict", { provider, kept: appIsNewer ? "app" : "shared" });
  }
}

/** 抄过去，只有自己能读写（抄文件不一定带着权限） */
function adopt(from, to) {
  copyFileSync(from, to);
  chmodSync(to, 0o600);
}
