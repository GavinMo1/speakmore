import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LocalizedError, msg } from "../../i18n/index.mjs";
import { noPositionals, parse } from "../common.mjs";

// speakmore update：下载地址上有更新的版本，就用那边的安装脚本把它装上。和把安装那一行再跑一次是同一回事
// （停掉、换掉程序、再启动，设置、key、历史和录音不动），只是不用记那一串地址。
// status 顺带提醒有没有新版本（newerVersion）：一天最多问一次下载地址。
// 只管用安装脚本装的那一份：从源码跑的用 git pull，装成应用的下载新的安装包。

/** 和安装脚本认的写法一样：v0.6.0、0.6.0-rc.1 */
const VERSION = /^v?(\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.-]+)?)$/;
/** status 问一次最多等几秒：它是顺带的，不能让看状态变慢 */
const STATUS_CHECK_SECONDS = 3;
const UPDATE_CHECK_SECONDS = 20;
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * 两个版本号比大小：按数比（0.10.0 比 0.9.0 新）；同一个号的预发版比正式版旧，预发版之间按 rc.9 < rc.10 比。
 * @returns {number} a 新是正数，一样是 0，a 旧是负数
 */
export function compareVersions(a, b) {
  const split = (version) => {
    const [core, ...pre] = version.split("-");
    return { numbers: core.split(".").map(Number), pre: pre.join("-") };
  };
  const left = split(a);
  const right = split(b);
  for (let index = 0; index < 3; index++) {
    const difference = left.numbers[index] - right.numbers[index];
    if (difference !== 0) return difference;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === "") return 1;
  if (right.pre === "") return -1;
  return left.pre.localeCompare(right.pre, "en", { numeric: true });
}

/**
 * 用安装脚本装的那一份：程序就在家目录的 app 里。比真实的路径：家目录可能经过符号链接
 * （/tmp 其实是 /private/tmp），而程序算出来的自己在哪是真实的路径
 */
function installedCopy(io) {
  try {
    return realpathSync(io.packageDir) === realpathSync(io.paths.appDir);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** 下载地址说的最新版本，去掉开头的 v。不像版本号的（比如问到的其实是一个报错的网页）不往下用 */
async function latestVersion(io, timeoutSeconds) {
  const answer = await io.updater.latest(timeoutSeconds);
  const match = VERSION.exec(answer);
  if (!match) throw new LocalizedError(msg("cli.update.badVersion", { value: JSON.stringify(answer) }));
  return match[1];
}

/** 上一次问的结果：{ checkedAt, latest }，latest 是 null 表示那次没问到。没问过、记录坏了都当没问过 */
function lastCheck(io) {
  try {
    const record = JSON.parse(readFileSync(io.paths.updateCheckFile, "utf8"));
    return Number.isFinite(Date.parse(record?.checkedAt)) ? record : null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function rememberCheck(io, latest) {
  mkdirSync(dirname(io.paths.updateCheckFile), { recursive: true });
  writeFileSync(io.paths.updateCheckFile, JSON.stringify({ checkedAt: io.now().toISOString(), latest }));
}

/**
 * 有没有比这一份新的版本（status 用）。一天最多问一次下载地址，结果记在家目录里。
 * 问不到就当没有：这只是顺带的提醒，不能让看状态因为没网而报错；要知道为什么问不到，speakmore update 会照实说。
 * 那次没问到也记下来，一天之后再问，免得没网时每看一次状态都等上几秒
 * @returns {Promise<string | null>} 新版本的版本号，没有是 null
 */
export async function newerVersion(io) {
  if (!installedCopy(io)) return null;
  let latest;
  const last = lastCheck(io);
  if (last !== null && io.now() - Date.parse(last.checkedAt) < CHECK_EVERY_MS) {
    latest = last.latest;
  } else {
    try {
      latest = await latestVersion(io, STATUS_CHECK_SECONDS);
    } catch {
      latest = null;
    }
    rememberCheck(io, latest);
  }
  return latest !== null && compareVersions(latest, io.version) > 0 ? latest : null;
}

export async function update(args, io) {
  noPositionals(parse(args).positionals, "update");
  const { t } = io;
  if (!installedCopy(io)) {
    io.err(t("cli.update.fromSource", { dir: io.packageDir }));
    return 1;
  }
  const latest = await latestVersion(io, UPDATE_CHECK_SECONDS);
  rememberCheck(io, latest);
  if (compareVersions(latest, io.version) <= 0) {
    io.out(t("cli.update.upToDate", { version: io.version }));
    return 0;
  }
  io.out(t("cli.update.updating", { current: io.version, latest }));
  // 装哪个版本说定了：问完到装上之间下载地址又出了更新的，也还是装刚才说的这个。
  // 安装脚本会把这一份的程序整个换掉：从这里往后不能再加载别的代码，等它跑完只交出退出码
  return (await io.updater.install(`v${latest}`)) === 0 ? 0 : 1;
}
