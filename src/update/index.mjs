import { TimeoutError } from "../control.mjs";
import { LocalizedError, msg, problemOf } from "../i18n/index.mjs";
import { bundleOfPackage, createBundles } from "./bundle.mjs";
import { createHomes, isHomeCopy } from "./home.mjs";
import { createRelease } from "./release.mjs";
import { acquireLock, isAlive, readCheck, readProgress, writeCheck, writeProgress } from "./state.mjs";
import { compareVersions, parseVersion } from "./versions.mjs";

// 版本检查和更新。命令行（speakmore status、update）和 App（设置 › 通用）都只调这里，看到的是同一份状态（state.mjs）。
// 更新把这台电脑上装着的每一份 SpeakMore 都换成最新的：家目录里的那一份（安装脚本装的，home.mjs），
// Mac 上还有 SpeakMore.app（bundle.mjs）。两份共用设置和数据，版本要跟上。按这个顺序：
//   1. 拿锁（命令行和 App 不能同时换），问最新版本
//   2. 把要换的都下好、核对好：这时正在运行的那个照常用，下载失败也什么都没动
//   3. 要换的程序正在运行的话请它退出，换上
//   4. 原来在运行的重新打开：换成了就是新的，没换成就是原来的
// App 发起的更新跑在另一个进程里（background.mjs）：App 在第 3 步退出、第 4 步被重新打开，照 update.json 显示结果。

const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
/** 顺带的检查（status、App 启动后）最多等几秒：不能因为没网让看状态变慢 */
const PASSIVE_TIMEOUT_SECONDS = 3;
/** 用户点了检查、要更新时等得久一些 */
const ACTIVE_TIMEOUT_SECONDS = 20;
/** 标着"正在更新"、可已经过了这么久的，进程号多半被别的程序用上了：算中断 */
const RUN_AT_MOST_MS = 2 * 60 * 60 * 1000;

/**
 * @param {object} options
 * @param {ReturnType<import("../storage/paths.mjs").resolvePaths>} options.paths
 * @param {Record<string, string | undefined>} options.env
 * @param {string} options.packageDir 这份程序的目录：据此认出它是家目录里的、应用包里的，还是从源码跑的
 * @param {string} options.version 这份程序的版本
 * @param {ReturnType<import("../instance.mjs").createInstance>} options.instance 正在运行的那个：问状态、请它退出
 * @param {boolean} [options.progress] 下载时在终端上显示进度条
 * @param {"inherit" | unknown[]} [options.stdio] 安装脚本、启动命令说的话接到哪
 */
export function createUpdates({
  paths,
  env,
  packageDir,
  version,
  instance,
  platform = process.platform,
  arch = process.arch,
  progress = false,
  stdio = "inherit",
  release = createRelease({ env, progress }),
  bundles = createBundles({ env, release, platform, arch }),
  homes = createHomes({ paths, env, release, stdio, platform, arch }),
  now = () => new Date(),
  pid = process.pid,
  alive = isAlive,
}) {
  const selfBundle = platform === "darwin" ? bundleOfPackage(packageDir) : null;
  /** 这份程序是哪一份：家目录里的（home）、Mac 的应用包（bundle）。从源码跑的是 null，不归更新管（用 git pull） */
  const self = isHomeCopy(packageDir, paths, platform) ? "home" : selfBundle ? "bundle" : null;

  /** 下载地址说的最新版本（不带 v）。不像版本号的（比如问到的其实是一个报错的网页）不往下用 */
  async function latestVersion(timeoutSeconds) {
    const answer = await release.latest(timeoutSeconds);
    const latest = parseVersion(answer);
    if (latest === null) throw new LocalizedError(msg("update.badVersion", { value: JSON.stringify(answer) }));
    return latest;
  }

  /**
   * 这台电脑上装着的各份和它们的版本
   * @param {number | null} runningApp 正在跑的 App 的进程号：用户可能没把它放在"应用程序"里
   * @returns {Promise<{ kind: "home" | "bundle", version: string, path?: string }[]>}
   */
  async function installed(runningApp = null) {
    const copies = [];
    const home = homes.find();
    if (home) copies.push({ kind: "home", version: home.version });
    const bundle = await bundles.find({ pid: runningApp, self: selfBundle });
    if (bundle) copies.push({ kind: "bundle", version: bundle.version, path: bundle.path });
    return copies;
  }

  /** 正在运行的那个；卡住不答话的是 "hung"（不知道是哪一份） */
  async function runningNow() {
    try {
      return await instance.status();
    } catch (error) {
      if (error instanceof TimeoutError) return "hung";
      throw error;
    }
  }

  /** 把停掉的那个重新打开。家目录里那一份的启动命令自己会说状态，失败的原因也在它说的话里 */
  async function reopen(stopped, copies, report) {
    if (stopped === "bundle") {
      const bundle = copies.find((copy) => copy.kind === "bundle");
      try {
        await bundles.open(bundle.path);
      } catch (error) {
        throw new LocalizedError(msg("update.reopenFailed", { reason: error.said ?? error.message }), { cause: error });
      }
      report(msg("update.reopened"));
    } else if (stopped === "home") {
      const code = await homes.start();
      if (code !== 0) throw new LocalizedError(msg("update.restartFailed", { code, log: paths.logFile }));
    }
  }

  return {
    self,

    /**
     * 有没有新版本。不是 force 的话一天最多问一次下载地址：结果记在家目录里，命令行和 App 共用，谁问过另一边就不用再问。
     * 问不到不抛：结果里 problem 说原因，latest 沿用之前知道的
     * @param {{ force?: boolean, runningApp?: number | null }} [options] runningApp 见 installed
     * @returns {Promise<{ fromSource: boolean, current: string, latest: string | null, checkedAt: string | null,
     *   available: boolean, behind: { kind: string, version: string, path?: string }[], problem: object | string | null }>}
     *   behind：比最新版本旧的那几份；available：有没有要更新的
     */
    async check({ force = false, runningApp = null } = {}) {
      const result = { fromSource: self === null, current: version, latest: null, checkedAt: null, problem: null };
      if (self === null) return { ...result, available: false, behind: [] };
      const last = readCheck(paths);
      result.latest = parseVersion(last?.latest);
      result.checkedAt = last?.checkedAt ?? null;
      if (force || last === null || now() - Date.parse(last.checkedAt) >= CHECK_EVERY_MS) {
        try {
          result.latest = await latestVersion(force ? ACTIVE_TIMEOUT_SECONDS : PASSIVE_TIMEOUT_SECONDS);
        } catch (error) {
          result.problem = problemOf(error);
        }
        // 没问到也记下：一天之内不再每次都等它（用户点检查、要更新时照样去问）
        result.checkedAt = now().toISOString();
        writeCheck(paths, { checkedAt: result.checkedAt, latest: result.latest });
      }
      const latest = result.latest;
      const behind =
        latest === null
          ? []
          : (await installed(runningApp)).filter((copy) => compareVersions(latest, copy.version) > 0);
      return { ...result, available: behind.length > 0, behind };
    },

    /**
     * 正在进行的、或者上一次的更新（update.json）；没有是 null。标着正在进行、可那个进程已经不在了的，算中断
     */
    progress() {
      const record = readProgress(paths);
      if (record?.state !== "running") return record;
      const stale = !alive(record.pid) || now() - Date.parse(record.startedAt) > RUN_AT_MOST_MS;
      return stale
        ? { ...record, state: "failed", problem: msg("update.interrupted", { log: paths.logFile }) }
        : record;
    },

    /** App 把更新的结果告诉过用户了，下次启动不再说 */
    markShown() {
      const record = readProgress(paths);
      if (record?.state === "done" || record?.state === "failed") writeProgress(paths, { ...record, shown: true });
    },

    /**
     * 把装着的每一份都换成最新版本，原来在运行的重新打开。
     * @param {{ by: "cli" | "app", report?: (message: object) => void }} options by：谁发起的（App 据此决定换完要不要
     *   把结果亮给用户看）；report：途中要让用户知道的事（msg）
     * @returns {Promise<{ updated: boolean, latest: string, restarted: "home" | "bundle" | null, running: boolean }>}
     *   已经是最新的时 updated 是 false；restarted：停掉又重新打开的是哪一份；running：现在有没有一个在运行
     * @throws {LocalizedError} 没换成（原因在 update.json 里也记了一份）
     */
    async run({ by, report = () => {} }) {
      if (self === null) throw new LocalizedError(msg("update.fromSource", { dir: packageDir }));
      const unlock = acquireLock(paths, { pid, alive });
      const record = { state: "running", phase: "checking", by, pid, startedAt: now().toISOString() };
      const save = (changes) => {
        Object.assign(record, changes);
        writeProgress(paths, record);
      };
      /** 下好了、还没换上的：没走到换那一步就出错时删掉 */
      let stagedBundle = null;
      let stagedHome = null;
      try {
        save({});
        const latest = await latestVersion(ACTIVE_TIMEOUT_SECONDS);
        writeCheck(paths, { checkedAt: now().toISOString(), latest });
        const running = await runningNow();
        const runningKind = running === null || running === "hung" ? null : running.packaged ? "bundle" : "home";
        const copies = await installed(runningKind === "bundle" ? running.pid : null);
        const behind = copies.filter((copy) => compareVersions(latest, copy.version) > 0);
        if (behind.length === 0) {
          save({ state: "current", phase: null, version: latest, finishedAt: now().toISOString() });
          return { updated: false, latest, restarted: null, running: Boolean(runningKind) };
        }
        const bundle = behind.find((copy) => copy.kind === "bundle") ?? null;
        const home = behind.find((copy) => copy.kind === "home") ?? null;
        save({
          phase: "downloading",
          version: latest,
          from: Object.fromEntries(behind.map((c) => [c.kind, c.version])),
        });
        if (bundle) stagedBundle = await bundles.stage(latest, bundle.path);
        if (home) stagedHome = await homes.stage(latest);

        // 要换的程序正在运行就请它退出。安装脚本换家目录里那一份之前，不管在跑的是哪一份都会先停掉它，所以这时都停；
        // 只换 App、在跑的是家目录里那一份的话不碍事，不停。卡住不答话的不知道是哪一份，停掉，之后也不知道该打开谁
        const stop =
          running === "hung" || (running !== null && (home !== null || (bundle !== null && runningKind === "bundle")));
        save({ phase: "installing" });
        if (stop) await instance.stop();
        const stopped = stop ? runningKind : null;

        let failure = null;
        try {
          if (stagedBundle) {
            report(msg("update.updatingApp", { current: bundle.version, latest }));
            const staged = stagedBundle;
            stagedBundle = null;
            staged.commit();
            report(msg("update.appDone", { version: latest }));
          }
          if (stagedHome) {
            report(msg("update.updating", { current: home.version, latest }));
            const code = await homes.install(stagedHome, latest);
            if (code !== 0) throw new LocalizedError(msg("update.installFailed", { code }));
          }
        } catch (error) {
          failure = error;
        }
        // 结果先记下，再把原来在运行的重新打开：打开的那个一启动就照它说（App 发起的，会把设置亮出来说一句）。
        // 没换成的也要打开（原来那个还在），只是照实报没换成
        const finish = (error) =>
          save(
            error
              ? { state: "failed", phase: null, problem: problemOf(error), finishedAt: now().toISOString() }
              : { state: "done", phase: null, finishedAt: now().toISOString() },
          );
        finish(failure);
        try {
          await reopen(stopped, copies, report);
        } catch (error) {
          failure ??= error;
          finish(failure);
        }
        if (failure) throw failure;
        // running：换完以后还有没有一个在运行（没停的那个，或者重新打开的那个）
        return { updated: true, latest, restarted: stopped, running: Boolean(runningKind) };
      } catch (error) {
        if (record.state !== "failed") {
          save({ state: "failed", phase: null, problem: problemOf(error), finishedAt: now().toISOString() });
        }
        throw error;
      } finally {
        // 下好了没换上的、临时目录：删不掉不算更新失败，说一声留在了哪
        for (const staged of [stagedBundle, stagedHome]) {
          const left = staged?.discard();
          if (left) report(msg("update.leftover", left));
        }
        unlock();
      }
    },
  };
}
