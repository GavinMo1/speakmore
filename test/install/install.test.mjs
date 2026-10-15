import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

// 安装脚本的测试：拿一个假的发布包（里面的"Electron"是个记下自己怎么被调用的小脚本）真的跑 install.sh，
// 装进临时的家目录。系统信息（系统版本、芯片、磁盘、是不是 root、连不连得上各家模型）用排在 PATH 前面的
// 同名小脚本冒充，所以不联网，也不碰真的 ~/.speakmore。
// 每条都要真的执行几个刚生成的脚本，macOS 第一次执行新文件时会先检查它，一次安装要 3–6 秒，
// 所以这一组单独跑、限时放得宽（npm run test:install），不拖慢平时的那一组。

const INSTALLER = resolve(import.meta.dirname, "..", "..", "install.sh");

let root;
/** 冒充用户的家目录 */
let userHome;
/** 放着假发布包的目录，当下载地址用 */
let release;
let shims;
/** 假 Electron 把每次被调用的情况记在这里 */
let callLog;

/** 假的 Electron：记下环境和参数，按第二个参数（脚本路径后面的那个）装样子 */
const FAKE_ELECTRON = `#!/bin/sh
printf '%s|%s|%s|%s\\n' "$ELECTRON_RUN_AS_NODE" "$SPEAKMORE_HOME" "$#" "$*" >> "$FAKE_CALL_LOG"
case "$2" in
  --version) [ -z "$FAKE_BROKEN" ] || exit 1; echo "$FAKE_VERSION" ;;
  # 真的命令行按终端的语言说话：只有指定了中文才说中文（安装脚本靠它说的话判断停没停、搬没搬）
  stop) [ -z "$FAKE_STOP_FAILS" ] || { echo "SpeakMore 停不掉（进程号 1）" >&2; exit 1; }
    [ "$SPEAKMORE_LANGUAGE" = zh-CN ] || { echo "SpeakMore wasn't running."; exit 0; }; echo "\${FAKE_STOP_SAYS:-SpeakMore 本来就没有在运行。}" ;;
esac
`;

/** 排在 PATH 前面、冒充系统命令的小脚本。没被要求装样子时照常转给真的 */
const SHIMS = {
  sw_vers: `#!/bin/sh\necho "\${FAKE_MACOS:-14.5}"\n`,
  uname: `#!/bin/sh\ncase "$1" in -s) echo "\${FAKE_OS:-Darwin}" ;; -m) echo "\${FAKE_ARCH:-arm64}" ;; *) exec /usr/bin/uname "$@" ;; esac\n`,
  id: `#!/bin/sh\n[ "$1" = "-u" ] && [ -n "$FAKE_UID" ] && { echo "$FAKE_UID"; exit 0; }\nexec /usr/bin/id "$@"\n`,
  df: `#!/bin/sh\n[ -n "$FAKE_FREE_KB" ] && { echo "Filesystem 1024-blocks Used Available Capacity Mounted on"; echo "/dev/x 9 9 $FAKE_FREE_KB 1% /"; exit 0; }\nexec /bin/df "$@"\n`,
  // 只有问各家模型连不连得上的那几次是假的；下载用的 file:// 照常交给真的 curl
  curl: `#!/bin/sh\ncase "$*" in *generativelanguage.googleapis.com*) exit "\${FAKE_GEMINI_EXIT:-0}" ;; *api.openai.com*) exit "\${FAKE_OPENAI_EXIT:-0}" ;; esac\nexec /usr/bin/curl "$@"\n`,
};

function makeArchive(arch, version = "9.9.9") {
  const staging = mkdtempSync(join(root, "pkg-"));
  const electron = join(staging, "runtime", "Electron.app", "Contents", "MacOS", "Electron");
  mkdirSync(join(electron, ".."), { recursive: true });
  writeFileSync(electron, FAKE_ELECTRON.replace('"$FAKE_VERSION"', `"${version}"`));
  chmodSync(electron, 0o755);
  mkdirSync(join(staging, "app", "bin"), { recursive: true });
  writeFileSync(join(staging, "app", "bin", "speakmore.mjs"), "// 假的\n");
  writeFileSync(join(staging, "app", "package.json"), `{\n  "name": "speakmore",\n  "version": "${version}"\n}\n`);
  // 和真的下载地址一个样子：每个版本的包在各自的目录里，根上的 latest 记着最新的是哪个
  mkdirSync(join(release, `v${version}`), { recursive: true });
  const archive = join(release, `v${version}`, `speakmore-darwin-${arch}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", staging, "app", "runtime"]);
  const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(`${archive}.sha256`, `${digest}  speakmore-darwin-${arch}.tar.gz\n`);
  writeFileSync(join(release, "latest"), `v${version}\n`);
  rmSync(staging, { recursive: true });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "smi-"));
  userHome = join(root, "u");
  release = join(root, "release");
  shims = join(root, "shims");
  callLog = join(root, "calls.log");
  for (const dir of [userHome, release, shims]) mkdirSync(dir);
  for (const [name, script] of Object.entries(SHIMS)) {
    writeFileSync(join(shims, name), script);
    chmodSync(join(shims, name), 0o755);
  }
  makeArchive("arm64");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** 跑一次安装脚本。env 里可以放 FAKE_* 让某项检查装样子 */
function install({ env = {}, args = [], path = "" } = {}) {
  const result = spawnSync("/bin/bash", [INSTALLER, ...args], {
    encoding: "utf8",
    env: {
      HOME: userHome,
      PATH: `${shims}:${path}/usr/bin:/bin:/usr/sbin:/sbin`,
      SPEAKMORE_INSTALL_BASE: release,
      FAKE_CALL_LOG: callLog,
      ...env,
    },
  });
  return { code: result.status, out: result.stdout, err: result.stderr, all: result.stdout + result.stderr };
}

const home = () => join(userHome, ".speakmore");
const calls = () => (existsSync(callLog) ? readFileSync(callLog, "utf8").trim().split("\n") : []);
const installedVersion = (dir = home()) => JSON.parse(readFileSync(join(dir, "app", "package.json"), "utf8")).version;

test("全新安装：程序和运行环境进了 ~/.speakmore，命令能用，家目录以外只多一个链接", () => {
  const { code, out } = install();
  assert.equal(code, 0, out);
  assert.match(out, /预检查[\s\S]*安装[\s\S]*装好了：SpeakMore 9\.9\.9/);
  assert.equal(installedVersion(), "9.9.9");
  assert.equal(statSync(home()).mode & 0o777, 0o700, "里面有录音和 key，只有自己进得去");
  // 下载和解包用的临时目录不留下
  assert.deepEqual(readdirSync(home()).sort(), ["app", "bin", "runtime"]);

  const link = join(userHome, ".local", "bin", "speakmore");
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.equal(readlinkSync(link), join(home(), "bin", "speakmore"));
  assert.equal(readFileSync(join(home(), "bin", "links"), "utf8"), `${link}\n`);
  // 用户的家目录里除了这两处，没有别的东西
  assert.deepEqual(readdirSync(userHome).sort(), [".local", ".speakmore"]);

  // 从链接运行：拿自带的 Electron 当 Node，跑的是装好的那份程序，参数原样传过去
  execFileSync(link, ["config", "set", "model", "a b"], { env: { PATH: "/usr/bin:/bin", FAKE_CALL_LOG: callLog } });
  assert.equal(calls().at(-1), `1|${home()}|5|${join(home(), "app", "bin", "speakmore.mjs")} config set model a b`);
});

test("没有终端可用时只装不启动，并说怎么启动", () => {
  const { out } = install();
  assert.match(out, /运行 speakmore 启动/);
  // 安装过程中只为了问版本和停掉旧的调过程序
  assert.deepEqual(
    calls().map((line) => line.split(" ").at(-1)),
    ["--version", "stop"],
  );
});

test("命令的链接建在 PATH 里的位置；~/.local/bin 不在 PATH 里时说清楚怎么加", () => {
  const missing = install();
  assert.match(missing.out, /不在 PATH 里/);
  assert.match(missing.out, /export PATH=/);

  rmSync(home(), { recursive: true });
  const present = install({ path: `${join(userHome, ".local", "bin")}:` });
  assert.equal(present.code, 0);
  assert.doesNotMatch(present.out, /不在 PATH 里/);
});

test("再装一次就是升级：程序换成新的，设置、key、历史和录音不动；先停掉正在运行的", () => {
  assert.equal(install().code, 0);
  for (const [file, content] of [
    ["settings.json", '{"hotkey":"fn"}'],
    ["gemini-key.bin", "密文"],
    ["data/history.db", "历史"],
    ["data/Recordings/a.webm", "录音"],
  ]) {
    mkdirSync(join(home(), file, ".."), { recursive: true });
    writeFileSync(join(home(), file), content);
  }
  rmSync(callLog);
  makeArchive("arm64", "10.0.0");

  const { code, out } = install({ env: { FAKE_STOP_SAYS: "SpeakMore 已经停掉。" } });
  assert.equal(code, 0, out);
  assert.match(out, /已经装着 9\.9\.9/);
  assert.match(out, /停掉了正在运行的那一个/);
  assert.match(out, /升级好了：9\.9\.9 → 10\.0\.0/);
  assert.equal(installedVersion(), "10.0.0");
  assert.equal(readFileSync(join(home(), "settings.json"), "utf8"), '{"hotkey":"fn"}');
  assert.equal(readFileSync(join(home(), "data", "Recordings", "a.webm"), "utf8"), "录音");
  assert.equal(readFileSync(join(home(), "gemini-key.bin"), "utf8"), "密文");
  assert.deepEqual(readdirSync(home()).sort(), ["app", "bin", "data", "gemini-key.bin", "runtime", "settings.json"]);
  // 链接的清单不重复记
  assert.equal(
    readFileSync(join(home(), "bin", "links"), "utf8")
      .trim()
      .split("\n").length,
    1,
  );
});

test("安装时把 0.1 版搬数据的结果说出来", () => {
  const { out } = install({
    env: { FAKE_STOP_SAYS: "旧版本的数据已经搬到 /x/.speakmore（history.db、Recordings）。" },
  });
  assert.match(out, /✓ 旧版本的数据已经搬到/);
});

/** 预检查没过、或者中途出错：以非零退出，把原因说清楚，已经装着的不动，没装过的不留下东西 */
function assertRefused(result, reason) {
  assert.equal(result.code, 1, result.all);
  assert.match(result.err, reason);
  assert.match(result.err, /没有装成/);
}

test("预检查不过就不往下走：不是 macOS、系统太旧、用了 sudo、磁盘不够", () => {
  for (const [env, reason] of [
    [{ FAKE_OS: "Linux" }, /只支持 macOS/],
    [{ FAKE_MACOS: "11.7.10" }, /macOS 版本太旧：11\.7\.10/],
    [{ FAKE_UID: "0" }, /不要用 sudo/],
    [{ FAKE_FREE_KB: "20480" }, /磁盘空间不够：还剩 20 MB/],
    [{ FAKE_ARCH: "riscv64" }, /不认识的芯片/],
  ]) {
    assertRefused(install({ env }), reason);
    assert.equal(existsSync(home()), false, `没装成就不留下目录：${JSON.stringify(env)}`);
    assert.deepEqual(calls(), []);
  }
});

test("Intel 芯片下的是 x64 的包；这个版本没有那种包时在下载之前就说清楚", () => {
  const result = install({ env: { FAKE_ARCH: "x86_64" } });
  assertRefused(result, /下载不到发布包/);
  assert.match(result.err, /speakmore-darwin-x64\.tar\.gz/);
  assert.equal(existsSync(home()), false);

  makeArchive("x64", "9.9.9");
  assert.equal(install({ env: { FAKE_ARCH: "x86_64" } }).code, 0);
});

test("默认装下载地址上标着最新的那个版本；SPEAKMORE_VERSION 可以指定另一个，带不带 v 都行", () => {
  makeArchive("arm64", "10.0.0");
  assert.equal(install().code, 0);
  assert.equal(installedVersion(), "10.0.0");

  assert.equal(install({ env: { SPEAKMORE_VERSION: "v9.9.9" } }).code, 0);
  assert.equal(installedVersion(), "9.9.9");
  assert.equal(install({ env: { SPEAKMORE_VERSION: "10.0.0" } }).code, 0);
  assert.equal(installedVersion(), "10.0.0");
});

test("问不到最新版本、问到的不像版本号、指定的版本不存在：都在下载之前说清楚，不装", () => {
  writeFileSync(join(release, "latest"), "<html>出错了</html>\n");
  assertRefused(install(), /下载地址给的最新版本号不对/);

  rmSync(join(release, "latest"));
  assertRefused(install(), /问不到最新版本/);

  assertRefused(install({ env: { SPEAKMORE_VERSION: "v1.2.3" } }), /下载不到发布包[\s\S]*v1\.2\.3/);
  assertRefused(install({ env: { SPEAKMORE_VERSION: "../../etc" } }), /SPEAKMORE_VERSION 不像版本号/);
});

test("安装脚本里查的几家，和程序里登记的模型厂商是同一份", async () => {
  const { PROVIDERS } = await import("../../src/server/providers/index.mjs");
  const listed = readFileSync(INSTALLER, "utf8")
    .match(/^MODEL_HOSTS=\((.*)\)$/m)[1]
    .match(/"[^"]*"/g);
  const names = listed.filter((_, index) => index % 2 === 0).map((quoted) => quoted.slice(1, -1));
  assert.deepEqual(
    names,
    PROVIDERS.map(({ name }) => name),
  );
});

test("能用的几家模型都查一遍连不连得上：连得上的打勾，连不上的只提醒，不拦着安装", () => {
  const both = install();
  assert.equal(both.code, 0);
  assert.match(both.out, /✓ 连得上 Gemini/);
  assert.match(both.out, /✓ 连得上 OpenAI/);

  const noGemini = install({ env: { FAKE_GEMINI_EXIT: "7" } });
  assert.equal(noGemini.code, 0);
  assert.match(noGemini.out, /! 现在连不上 Gemini/);
  assert.match(noGemini.out, /✓ 连得上 OpenAI/);

  const neither = install({ env: { FAKE_GEMINI_EXIT: "7", FAKE_OPENAI_EXIT: "7" } });
  assert.equal(neither.code, 0);
  assert.match(neither.out, /! 现在连不上 Gemini/);
  assert.match(neither.out, /! 现在连不上 OpenAI/);
  // 怎么办只说一遍
  assert.equal(neither.out.match(/需要代理的话/g)?.length, 1);
  assert.equal(installedVersion(), "9.9.9");
});

test("下到的包和发布时的不一样（校验不过）：不装，已经装着的那一份不动", () => {
  assert.equal(install().code, 0);
  makeArchive("arm64", "10.0.0");
  writeFileSync(join(release, "v10.0.0", "speakmore-darwin-arm64.tar.gz.sha256"), `${"0".repeat(64)}  x\n`);
  assertRefused(install(), /校验没通过/);
  assert.equal(installedVersion(), "9.9.9");
  assert.deepEqual(readdirSync(home()).sort(), ["app", "bin", "runtime"]);
});

test("下到的程序在这台机器上跑不起来：换掉旧的之前就发现，旧的不动", () => {
  assert.equal(install().code, 0);
  makeArchive("arm64", "10.0.0");
  assertRefused(install({ env: { FAKE_BROKEN: "1" } }), /跑不起来/);
  assert.equal(installedVersion(), "9.9.9");
});

test("正在运行的停不掉：不换（它还开着旧程序的文件）", () => {
  assert.equal(install().code, 0);
  makeArchive("arm64", "10.0.0");
  const result = install({ env: { FAKE_STOP_FAILS: "1" } });
  assertRefused(result, /停不掉/);
  assert.equal(installedVersion(), "9.9.9");
});

test("链接的位置上已经有别人的同名文件：不动它，告诉用户用完整路径", () => {
  const theirs = join(userHome, ".local", "bin", "speakmore");
  mkdirSync(join(theirs, ".."), { recursive: true });
  writeFileSync(theirs, "别人的");
  const { code, out } = install();
  assert.equal(code, 0);
  assert.match(out, /已经有一个别的 speakmore，没有动它/);
  assert.equal(readFileSync(theirs, "utf8"), "别人的");
  assert.equal(existsSync(join(home(), "bin", "links")), false);
});

test("PATH 里排在前面的是另一个 speakmore 时提醒一句", () => {
  const other = join(root, "other-bin");
  mkdirSync(other);
  writeFileSync(join(other, "speakmore"), "#!/bin/sh\n");
  chmodSync(join(other, "speakmore"), 0o755);
  const { out } = install({ path: `${other}:${join(userHome, ".local", "bin")}:` });
  assert.match(out, /排在前面的还有另一个 speakmore/);
});

test("装到别处（SPEAKMORE_HOME），路径里有空格和引号也行；链接可以另指一个目录", () => {
  const custom = join(root, "my 'own' home");
  const bin = join(root, "bin dir");
  const { code, out } = install({ env: { SPEAKMORE_HOME: custom, SPEAKMORE_BIN_DIR: bin } });
  assert.equal(code, 0, out);
  assert.equal(installedVersion(custom), "9.9.9");
  assert.equal(existsSync(home()), false);
  execFileSync(join(bin, "speakmore"), ["status"], { env: { PATH: "/usr/bin:/bin", FAKE_CALL_LOG: callLog } });
  assert.equal(calls().at(-1), `1|${custom}|2|${join(custom, "app", "bin", "speakmore.mjs")} status`);
});

test("不认识的参数：不装", () => {
  assertRefused(install({ args: ["--force"] }), /不认识的参数：--force/);
  assert.equal(existsSync(home()), false);
});
