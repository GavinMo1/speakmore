import { existsSync, readdirSync, rmdirSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import { TimeoutError } from "../control.mjs";
import { LocalizedError, msg, problemOf } from "../i18n/index.mjs";
import { sizeText } from "../models/describe.mjs";
import { readLocationRecord, removeLocation, sameHome, writeLocation } from "../storage/location.mjs";
import { MOVED_FILE } from "../storage/paths.mjs";
import { createBundles } from "../update/bundle.mjs";
import { runToEnd } from "../update/exec.mjs";
import { acquireLock, isAlive } from "../update/state.mjs";
import { classifyHome, copyHome, measureHome, verifyCopy } from "./copy.mjs";
import { canRehome, installerIn, rehome } from "./installer.mjs";
import { probeTarget } from "./probe.mjs";
import { readMoveRecord, stillMoving, writeMoveRecord } from "./state.mjs";
import { canonicalDir, checkTarget } from "./target.mjs";

// 把整个家目录搬到别处（speakmore move、App 设置里的"存储位置"）。命令行和 App 都只调这里。按这个顺序：
//   1. 检查新位置（target.mjs）、本机每一份 SpeakMore 都认得换家（家目录里的程序、Mac 上"应用程序"里的 App）
//   2. 拿锁（和更新共用 update.lock），旧目录 run/move.json 记"正在搬"（这时 App、后台都不在这里启动），
//      定位文件记上 moving（断了电下次认得出新位置那一份是半成品）
//   3. 在新位置试盘（probe.mjs）；停掉正在运行的；只拷 SpeakMore 自己的东西（copy.mjs），核对符号链接
//   4. 提交：新位置的安装脚本换家（试跑、改系统入口、写定位文件；installer.mjs）。没装程序的（Mac 上只装了 dmg 的）直接写定位文件
//   5. 旧目录放下 MOVED.json（从残留的旧入口启动会被告知搬去了哪），原来在运行的从新位置重新打开，删旧目录
//      （只删我们的；Windows 上这个进程自己就跑在旧目录的程序上，等它退出再删）
// 提交之前任何一步出错：旧目录原样在用，改过的入口换回去（对旧目录再换一次家），定位文件换回去，拷了一半的删掉，照实报。
// 搬到一半进程没了（断电、被结束）：下次从旧目录启动或再搬一次时 settleMove 照定位文件里的 moving 收拾好。

/** 新位置的剩余空间至少多留这么多：日志、更新时下的块还要地方 */
const SPARE_BYTES = 200 * 1024 * 1024;

const pathModule = (platform) => (platform === "win32" ? win32 : posix);

/** 另一个家目录的摆法：paths 里落在 from 下面的都换到 home 下面（不经定位文件，不看 MOVED.json） */
function pathsFor(paths, home) {
  const from = paths.home;
  const sub = { ...paths, home };
  for (const [name, value] of Object.entries(paths)) {
    if (name === "home" || typeof value !== "string") continue;
    if (value.startsWith(`${from}/`) || value.startsWith(`${from}\\`)) sub[name] = home + value.slice(from.length);
  }
  return sub;
}

/**
 * 删掉一个家目录里 SpeakMore 的东西，不认识的留着。只剩 MOVED.json（或者什么都不剩）就连目录一起删；
 * 还有别的东西时 MOVED.json 留着：从那里启动的会被告知搬去了哪
 * @returns {string[]} 留下没删的（不认识的）
 */
function removeOurs(paths, home) {
  if (!existsSync(home)) return [];
  const contents = classifyHome(pathsFor(paths, home));
  for (const name of [...contents.move, ...contents.leftovers])
    rmSync(join(home, name), { recursive: true, force: true });
  const rest = readdirSync(home).filter((name) => name !== MOVED_FILE);
  if (rest.length === 0) {
    rmSync(join(home, MOVED_FILE), { force: true });
    rmdirSync(home);
  }
  return rest;
}

/** 两个写法是不是同一个家目录（经过符号链接、大小写不同的也认，见 target.mjs 的 canonicalDir） */
const sameDir = (a, b, platform) => sameHome(canonicalDir(a, platform), canonicalDir(b, platform), platform);

/** 记下 SpeakMore 在哪：默认位置不要定位文件，别处就写（按正式写法） */
function commitLocation(paths, home, defaultHome, platform) {
  if (sameDir(home, defaultHome, platform)) removeLocation(paths.locationFile);
  else writeLocation(paths.locationFile, { home: canonicalDir(home, platform) });
}

/**
 * 启动之前、搬家之前看一眼有没有搬到一半的：
 *   - 正在搬（搬的那个进程还在）：不在这里启动，照实说
 *   - 上次搬到一半那个进程没了：旧目录照常在用。从旧目录启动的，把改指了一半的系统入口换回来（对旧目录再换一次家）、
 *     删掉新位置上拷了一半的、定位文件去掉 moving；从拷了一半的那一份启动的，不在它上面启动，说回旧目录去
 * App 启动、命令行起后台、speakmore move 都先调它。什么事都没有时什么都不做
 * @throws {LocalizedError} move.inProgress / move.unfinishedCopy
 */
export async function settleMove({
  paths,
  env,
  platform = process.platform,
  stdio = "inherit",
  userHome = homedir(),
  runRehome = rehome,
  pid = process.pid,
  alive = isAlive,
  now,
  report = () => {},
}) {
  const record = readMoveRecord(paths);
  if (record?.pid !== pid && stillMoving(record, { alive, now })) {
    throw new LocalizedError(msg("move.inProgress", { home: paths.home, to: record.to ?? "?" }));
  }
  let location = null;
  try {
    location = readLocationRecord(paths.locationFile, platform);
  } catch {
    // 定位文件坏了由找家目录的那一步报（paths.mjs）
    return;
  }
  const moving = location?.moving;
  if (!moving) return;
  if (Number.isInteger(moving.pid) && moving.pid !== pid && alive(moving.pid)) {
    throw new LocalizedError(msg("move.inProgress", { home: location.home, to: moving.to }));
  }
  if (sameDir(moving.to, paths.home, platform)) {
    throw new LocalizedError(msg("move.unfinishedCopy", { home: paths.home, from: location.home }));
  }
  if (!sameDir(location.home, paths.home, platform)) return;
  const from = paths.home;
  if (existsSync(moving.to) && installerIn(from, platform) !== null) {
    const code = await runRehome({ home: from, previous: moving.to, env, stdio, platform });
    if (code !== 0) throw new LocalizedError(msg("move.rehomeFailed", { code }));
  }
  removeOurs(paths, moving.to);
  commitLocation(paths, from, pathModule(platform).join(userHome, ".speakmore"), platform);
  if (record?.state === "running") {
    writeMoveRecord(paths, {
      ...record,
      state: "failed",
      problem: msg("move.interrupted"),
      finishedAt: new Date().toISOString(),
    });
  }
  report(msg("move.recovered", { home: from, to: moving.to }));
}

/**
 * @param {object} options
 * @param {ReturnType<import("../storage/paths.mjs").resolvePaths>} options.paths 现在的家目录
 * @param {Record<string, string | undefined>} options.env 交给安装脚本、重新打开的 App 的环境（不能带着只给这一次用的变量）
 * @param {ReturnType<import("../instance.mjs").createInstance>} options.instance 现在家目录里正在运行的那个
 * @param {"inherit" | "forward"} [options.stdio] 安装脚本、启动命令说的话接到哪（update/exec.mjs）
 * @param {string | null} [options.selfBundle] Mac 上这份程序所在的应用包（App 发起时）
 * @param {(app: string, home: string) => Promise<void>} [options.openApp] 把 Mac 的 App 从新位置重新打开
 * @param {{ clearUserHome?: (home: string) => boolean,
 *   removeHomeAfterExit?: (home: string, names: string[], pids: number[]) => void } | null} [options.system]
 *   Windows 上要动系统的几处（src/windows-system.mjs）
 */
export function createMove({
  paths,
  env,
  instance,
  platform = process.platform,
  stdio = "inherit",
  selfBundle = null,
  userHome = homedir(),
  bundles = createBundles({ env, release: null, platform }),
  probe = probeTarget,
  runRehome = rehome,
  openApp = (app, home) => createBundles({ env: { ...env, SPEAKMORE_HOME: home }, release: null, platform }).open(app),
  system = null,
  pid = process.pid,
  ppid = process.ppid,
  alive = isAlive,
  now = () => new Date(),
}) {
  const path = pathModule(platform);
  const defaultHome = path.join(userHome, ".speakmore");
  const from = paths.home;

  /** 正在运行的那个；卡住不答话的是 "hung" */
  async function runningNow() {
    try {
      return await instance.status();
    } catch (error) {
      if (error instanceof TimeoutError) return "hung";
      throw error;
    }
  }

  /** Mac 上"应用程序"里的 App（或者正在跑的那个应用包）；它认不认定位文件 */
  async function findApp(running) {
    if (platform !== "darwin") return null;
    const pidOfApp = running && running !== "hung" && running.packaged ? running.pid : null;
    return bundles.find({ pid: pidOfApp, self: selfBundle });
  }

  /** 本机每一份都得认得换家：不然搬完以后，旧的那一份找不到新位置（看着像数据丢了），或者换不了家 */
  function checkCopies(app) {
    const script = installerIn(from, platform);
    if (script !== null && !canRehome(script)) throw new LocalizedError(msg("move.homeTooOld", { home: from }));
    if (app && !existsSync(join(app.path, "Contents", "Resources", "app", "src", "storage", "location.mjs"))) {
      throw new LocalizedError(msg("move.appTooOld", { app: app.path, version: app.version }));
    }
  }

  /** 新位置的盘够不够：同一块 APFS 上拷是克隆，不另占地方 */
  function checkSpace(folder, bytes) {
    if (platform === "darwin" && statSync(folder).dev === statSync(from).dev) return;
    const { bavail, bsize } = statfsSync(folder);
    const free = Number(bavail) * Number(bsize);
    if (free < bytes + SPARE_BYTES) {
      throw new LocalizedError(
        msg("move.noSpace", { need: sizeText(bytes + SPARE_BYTES), free: sizeText(free), folder }),
      );
    }
  }

  /**
   * 只搬记着的那一个（定位文件说的，没有就是默认位置）。这一次的家目录是 SPEAKMORE_HOME 临时指的（开发、测试）时不搬：
   * 不然定位文件会改指到它，真正装着的那一份就被盖住了
   */
  function checkRecorded() {
    const recorded = readLocationRecord(paths.locationFile, platform)?.home ?? defaultHome;
    if (!sameDir(recorded, from, platform)) throw new LocalizedError(msg("move.notRecorded", { home: from, recorded }));
  }

  /** 检查新位置、本机的每一份、盘够不够。交回新家目录、要搬的、要拷多少 */
  async function prepare(folder, { keep }) {
    checkRecorded();
    const { home: to } = checkTarget({ paths, folder, platform });
    const running = await runningNow();
    const app = await findApp(running);
    checkCopies(app);
    const contents = classifyHome(paths);
    const size = measureHome({ from, plan: contents });
    checkSpace(path.dirname(to), size.bytes);
    // 试盘放在最后、停掉正在运行的之前：盘不行（exFAT 这类）就在问"确定吗"之前说，不让 App 白退出一次。
    // 只是问一句（keep 为假）时，这里建的目录试完就删
    const { created } = await probe(to, { platform });
    if (!keep && created) rmSync(to, { recursive: true, force: true });
    return { to, running, app, contents, size, created };
  }

  /** 把停掉的那个重新打开：家目录里那一份用它的启动命令，Mac 的 App 用 open。打不开照实交回原因 */
  async function reopen(stopped, appPath, home, report) {
    if (stopped === "bundle" && appPath) {
      await openApp(appPath, home);
      report(msg("move.reopened"));
    } else if (stopped === "home") {
      const { ELECTRON_RUN_AS_NODE: _asNode, ...startEnv } = env;
      startEnv.SPEAKMORE_HOME = home;
      const code =
        platform === "win32"
          ? await runToEnd(`"${path.join(home, "bin", "speakmore.cmd")}" start`, [], {
              env: startEnv,
              stdio,
              shell: true,
            })
          : await runToEnd(path.join(home, "bin", "speakmore"), ["start"], { env: startEnv, stdio });
      if (code !== 0) throw new LocalizedError(msg("move.restartFailed", { code }));
    }
  }

  /** 搬不成：删掉拷过去的。新家目录是这里建的就整个删；本来就有的（空的）只删里面的，目录留着 */
  function discardCopy(to, created) {
    if (created) {
      rmSync(to, { recursive: true, force: true });
      return;
    }
    if (!existsSync(to)) return;
    for (const name of readdirSync(to)) rmSync(join(to, name), { recursive: true, force: true });
  }

  async function move(folder, by, report, onProgress) {
    const record = { state: "running", by, from, to: null, pid, startedAt: now().toISOString() };
    let to = null;
    /** 新家目录是不是这里建的：搬不成时整个删；本来就有（空的）就只删里面拷进去的 */
    let created = false;
    let touched = false;
    let copied = false;
    let stopped = null;
    let appPath = null;
    let contents = null;
    let stats = null;
    try {
      await settleMove({ paths, env, platform, stdio, userHome, runRehome, pid, alive, now, report });
      const prepared = await prepare(folder, { keep: true });
      to = prepared.to;
      created = prepared.created;
      touched = true;
      record.to = to;
      writeMoveRecord(paths, record);
      writeLocation(paths.locationFile, {
        home: canonicalDir(from, platform),
        moving: { to, pid, startedAt: record.startedAt },
      });

      if (prepared.running !== null) {
        if (prepared.running !== "hung") stopped = prepared.running.packaged ? "bundle" : "home";
        appPath = stopped === "bundle" ? (prepared.app?.path ?? null) : null;
        await instance.stop();
      }
      // 停掉之后再看一遍：停之前它可能还在写
      contents = classifyHome(paths);
      const total = measureHome({ from, plan: contents });
      report(msg("move.copying", { to }));
      onProgress({ files: 0, bytes: 0, total });
      stats = await copyHome({ from, to, plan: contents, onProgress: (done) => onProgress({ ...done, total }) });
      try {
        verifyCopy({ to });
      } catch (error) {
        throw new LocalizedError(msg("move.copyBroken", { reason: error.message }), { cause: error });
      }
      copied = true;
      report(msg("move.switching"));
      if (installerIn(to, platform) !== null) {
        const code = await runRehome({ home: to, previous: from, env, stdio, platform });
        if (code !== 0) throw new LocalizedError(msg("move.rehomeFailed", { code }));
      } else {
        commitLocation(paths, to, defaultHome, platform);
      }
    } catch (error) {
      // 没提交：旧目录照常在用。改过的入口换回去，定位文件换回去，拷的删掉，原来在运行的从旧位置重新打开
      const problems = [];
      const attempt = async (step) => {
        try {
          await step();
        } catch (failure) {
          problems.push(problemOf(failure));
        }
      };
      if (copied && installerIn(from, platform) !== null) {
        await attempt(async () => {
          const code = await runRehome({ home: from, previous: to, env, stdio, platform });
          if (code !== 0) throw new LocalizedError(msg("move.rehomeFailed", { code }));
        });
      }
      if (record.to !== null) await attempt(() => commitLocation(paths, from, defaultHome, platform));
      if (touched) await attempt(() => discardCopy(to, created));
      if (record.to !== null) {
        await attempt(() =>
          writeMoveRecord(paths, {
            ...record,
            state: "failed",
            problem: problemOf(error),
            finishedAt: now().toISOString(),
          }),
        );
      }
      await attempt(() => reopen(stopped, appPath, from, report));
      for (const problem of problems) report(msg("move.cleanupProblem", { problem }));
      throw error;
    }

    // 提交了：新位置就是 SpeakMore 的家。以下哪一步出问题都不再退回，照实说
    const result = {
      from,
      to,
      files: stats.files,
      bytes: stats.bytes,
      unknown: contents.unknown,
      left: [],
      later: false,
    };
    try {
      writeMoveRecord(pathsFor(paths, to), { ...record, state: "done", finishedAt: now().toISOString() });
    } catch (error) {
      report(msg("move.recordFailed", { reason: error.code ?? error.message }));
    }
    // 旧目录里放下记号：删完之前从残留的旧入口启动的，会被告知搬去了哪（paths.mjs）
    try {
      writeFileSync(join(from, MOVED_FILE), JSON.stringify({ to }));
    } catch (error) {
      report(msg("move.leftover", { dir: from, reason: error.code ?? error.message }));
    }
    if (system?.clearUserHome) {
      try {
        if (system.clearUserHome(from)) report(msg("move.clearedEnv"));
      } catch (error) {
        report(msg("move.leftover", { dir: "SPEAKMORE_HOME", reason: error.message }));
      }
    }
    try {
      await reopen(stopped, appPath, to, report);
    } catch (error) {
      report(msg("move.reopenFailed", { reason: problemOf(error) }));
    }
    // 删旧目录：只删我们的。Windows 上这个进程（和起它的 speakmore.cmd）跑在旧目录的程序上，删不掉自己，交给退出之后
    if (platform === "win32" && system?.removeHomeAfterExit) {
      try {
        system.removeHomeAfterExit(from, [...contents.move, ...contents.leftovers], [pid, ppid]);
        result.later = true;
      } catch (error) {
        report(msg("move.leftover", { dir: from, reason: error.message }));
      }
      result.left = contents.unknown;
    } else {
      try {
        result.left = removeOurs(paths, from);
      } catch (error) {
        report(msg("move.leftover", { dir: from, reason: error.code ?? error.message }));
        result.left = [from];
      }
    }
    return result;
  }

  return {
    /**
     * 能不能搬到这个文件夹、要拷多少：给命令行、App 在动手之前问一句"确定吗"用。
     * 除了在新位置试一下盘（试完删掉）不动磁盘
     * @returns {Promise<{ from: string, to: string, files: number, bytes: number, unknown: string[] }>}
     */
    async plan(folder) {
      const { to, contents, size } = await prepare(folder, { keep: false });
      return { from, to, files: size.files, bytes: size.bytes, unknown: contents.unknown };
    },

    /**
     * 搬。成了交回结果；没成抛出原因（旧目录照常在用）
     * @param {{ folder: string, by: "cli" | "app", report?: (message: object) => void,
     *   onProgress?: (progress: { files: number, bytes: number, total: { files: number, bytes: number } }) => void }} options
     * @returns {Promise<{ from: string, to: string, files: number, bytes: number, unknown: string[], left: string[],
     *   later: boolean }>} left：旧目录里留下没删的；later：旧目录等这个进程退出后再删（Windows）
     */
    async run({ folder, by, report = () => {}, onProgress = () => {} }) {
      const unlock = acquireLock(paths, { pid, alive });
      try {
        return await move(folder, by, report, onProgress);
      } finally {
        // 搬成了的话锁文件跟着旧目录一起删了，放锁时找不到不算错
        unlock();
      }
    },
  };
}
