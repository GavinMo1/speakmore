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
  realpathSync,
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
  # 真的命令行按终端的语言说话：没指定英文时就说中文（安装脚本靠它说的话判断停没停、搬没搬）
  stop) [ -z "$FAKE_STOP_FAILS" ] || { echo "Couldn't stop SpeakMore (pid 1)" >&2; exit 1; }
    [ "$SPEAKMORE_LANGUAGE" = en ] || { echo "SpeakMore 本来就没有在运行。"; exit 0; }; echo "\${FAKE_STOP_SAYS:-SpeakMore was not running.}" ;;
esac
`;

/** 排在 PATH 前面、冒充系统命令的小脚本。没被要求装样子时照常转给真的 */
const SHIMS = {
  sw_vers: `#!/bin/sh\necho "\${FAKE_MACOS:-14.5}"\n`,
  uname: `#!/bin/sh\ncase "$1" in -s) echo "\${FAKE_OS:-Darwin}" ;; -m) echo "\${FAKE_ARCH:-arm64}" ;; *) exec /usr/bin/uname "$@" ;; esac\n`,
  id: `#!/bin/sh\n[ "$1" = "-u" ] && [ -n "$FAKE_UID" ] && { echo "$FAKE_UID"; exit 0; }\nexec /usr/bin/id "$@"\n`,
  df: `#!/bin/sh\n[ -n "$FAKE_FREE_KB" ] && { echo "Filesystem 1024-blocks Used Available Capacity Mounted on"; echo "/dev/x 9 9 $FAKE_FREE_KB 1% /"; exit 0; }\nexec /bin/df "$@"\n`,
  // 只有问各家模型连不连得上的那几次是假的；下载用的 file:// 照常交给真的 curl
  curl: `#!/bin/sh\ncase "$*" in *generativelanguage.googleapis.com*) exit "\${FAKE_GEMINI_EXIT:-0}" ;; *api.openai.com*) exit "\${FAKE_OPENAI_EXIT:-0}" ;; *dashscope.aliyuncs.com*) exit "\${FAKE_BAILIAN_EXIT:-0}" ;; esac\nexec /usr/bin/curl "$@"\n`,
};

/** 摆一棵和包里一样的树（app/ 和 runtime/）：假的 Electron 报这个版本 */
function makeTree(version) {
  const staging = mkdtempSync(join(root, "pkg-"));
  const electron = join(staging, "runtime", "Electron.app", "Contents", "MacOS", "Electron");
  mkdirSync(join(electron, ".."), { recursive: true });
  writeFileSync(electron, FAKE_ELECTRON.replace('"$FAKE_VERSION"', `"${version}"`));
  chmodSync(electron, 0o755);
  mkdirSync(join(staging, "app", "bin"), { recursive: true });
  writeFileSync(join(staging, "app", "bin", "speakmore.mjs"), "// 假的\n");
  writeFileSync(join(staging, "app", "package.json"), `{\n  "name": "speakmore",\n  "version": "${version}"\n}\n`);
  return staging;
}

function makeArchive(arch, version = "9.9.9") {
  const staging = makeTree(version);
  // 和真的下载地址一个样子：每个版本的包在各自的目录里，根上的 channel.json 记着最新的是哪个（release.mjs 写的那种）
  mkdirSync(join(release, `v${version}`), { recursive: true });
  const archive = join(release, `v${version}`, `speakmore-darwin-${arch}.tar.xz`);
  execFileSync("tar", ["-cJf", archive, "-C", staging, "app", "runtime"]);
  const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(`${archive}.sha256`, `${digest}  speakmore-darwin-${arch}.tar.xz\n`);
  const channel = { version, electron: "44.0.0", targets: { [`darwin-${arch}`]: "a".repeat(64) } };
  writeFileSync(join(release, "channel.json"), `${JSON.stringify(channel, null, 2)}\n`);
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

/** 定位文件（src/storage/location.mjs）：记着 SpeakMore 的目录在哪 */
const locationFile = () => join(userHome, ".config", "speakmore", "location.json");
const recorded = () => JSON.parse(readFileSync(locationFile(), "utf8")).home;

test("全新安装：程序和运行环境进了 ~/.speakmore，命令能用，家目录以外只多一个链接和定位文件", () => {
  const { code, out, all } = install();
  assert.equal(code, 0, all);
  assert.match(out, /Checks[\s\S]*Install[\s\S]*Installed SpeakMore 9\.9\.9/);
  assert.equal(installedVersion(), "9.9.9");
  assert.equal(statSync(home()).mode & 0o777, 0o700, "里面有录音和 key，只有自己进得去");
  // 下载和解包用的临时目录不留下
  assert.deepEqual(readdirSync(home()).sort(), ["app", "bin", "runtime"]);

  const link = join(userHome, ".local", "bin", "speakmore");
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.equal(readlinkSync(link), join(home(), "bin", "speakmore"));
  assert.equal(readFileSync(join(home(), "bin", "links"), "utf8"), `${link}\n`);
  // 记下了装在哪；用户的家目录里除了这几处，没有别的东西
  assert.equal(recorded(), home());
  assert.deepEqual(readdirSync(join(userHome, ".config")), ["speakmore"]);
  assert.deepEqual(readdirSync(userHome).sort(), [".config", ".local", ".speakmore"]);

  // 从链接运行：拿自带的 Electron 当 Node，跑的是装好的那份程序，参数原样传过去
  execFileSync(link, ["config", "set", "model", "a b"], { env: { PATH: "/usr/bin:/bin", FAKE_CALL_LOG: callLog } });
  assert.equal(calls().at(-1), `1|${home()}|5|${join(home(), "app", "bin", "speakmore.mjs")} config set model a b`);
});

test("没有终端可用时只装不启动，并说怎么启动", () => {
  const { out } = install();
  assert.match(out, /Run speakmore to start/);
  // 安装过程中只为了问版本和停掉旧的调过程序
  assert.deepEqual(
    calls().map((line) => line.split(" ").at(-1)),
    ["--version", "stop"],
  );
});

test("命令的链接建在 PATH 里的位置；~/.local/bin 不在 PATH 里时说清楚怎么加", () => {
  const missing = install();
  assert.match(missing.out, /isn't on your PATH/);
  assert.match(missing.out, /export PATH=/);

  rmSync(home(), { recursive: true });
  const present = install({ path: `${join(userHome, ".local", "bin")}:` });
  assert.equal(present.code, 0);
  assert.doesNotMatch(present.out, /isn't on your PATH/);
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

  const { code, out } = install({ env: { FAKE_STOP_SAYS: "SpeakMore stopped." } });
  assert.equal(code, 0, out);
  assert.match(out, /Found 9\.9\.9/);
  assert.match(out, /Stopped the running SpeakMore/);
  assert.match(out, /Upgraded: 9\.9\.9 → 10\.0\.0/);
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
    env: { FAKE_STOP_SAYS: "Moved the old version's data to /x/.speakmore (history.db, Recordings)." },
  });
  assert.match(out, /✓ Moved the old version's data to \/x\/\.speakmore/);
});

/** 预检查没过、或者中途出错：以非零退出，把原因说清楚，已经装着的不动，没装过的不留下东西 */
function assertRefused(result, reason) {
  assert.equal(result.code, 1, result.all);
  assert.match(result.err, reason);
  assert.match(result.err, /Nothing was installed/);
}

test("预检查不过就不往下走：不是 macOS、系统太旧、用了 sudo、磁盘不够", () => {
  for (const [env, reason] of [
    [{ FAKE_OS: "Linux" }, /only supports macOS/],
    [{ FAKE_MACOS: "11.7.10" }, /macOS 11\.7\.10 is too old/],
    [{ FAKE_UID: "0" }, /Don't run this with sudo/],
    [{ FAKE_FREE_KB: "20480" }, /Not enough disk space: 20 MB free/],
    [{ FAKE_ARCH: "riscv64" }, /Unknown chip/],
  ]) {
    assertRefused(install({ env }), reason);
    assert.equal(existsSync(home()), false, `没装成就不留下目录：${JSON.stringify(env)}`);
    assert.deepEqual(calls(), []);
  }
});

test("Intel 芯片下的是 x64 的包；这个版本没有那种包时在下载之前就说清楚", () => {
  const result = install({ env: { FAKE_ARCH: "x86_64" } });
  assertRefused(result, /Couldn't reach the release package/);
  assert.match(result.err, /speakmore-darwin-x64\.tar\.xz/);
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
  writeFileSync(join(release, "channel.json"), '{ "version": "<html>出错了</html>" }\n');
  assertRefused(install(), /returned a bad version number/);
  writeFileSync(join(release, "channel.json"), "<html>出错了</html>\n");
  assertRefused(install(), /Couldn't find the latest version/);

  rmSync(join(release, "channel.json"));
  assertRefused(install(), /Couldn't find the latest version/);

  assertRefused(install({ env: { SPEAKMORE_VERSION: "v1.2.3" } }), /Couldn't reach the release package[\s\S]*v1\.2\.3/);
  assertRefused(install({ env: { SPEAKMORE_VERSION: "../../etc" } }), /SPEAKMORE_VERSION doesn't look like a version/);
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
  assert.match(both.out, /✓ Gemini reachable/);
  assert.match(both.out, /✓ OpenAI reachable/);
  assert.match(both.out, /✓ Bailian reachable/);

  const noGemini = install({ env: { FAKE_GEMINI_EXIT: "7" } });
  assert.equal(noGemini.code, 0);
  assert.match(noGemini.out, /! Can't reach Gemini/);
  assert.match(noGemini.out, /✓ OpenAI reachable/);

  const neither = install({ env: { FAKE_GEMINI_EXIT: "7", FAKE_OPENAI_EXIT: "7" } });
  assert.equal(neither.code, 0);
  assert.match(neither.out, /! Can't reach Gemini/);
  assert.match(neither.out, /! Can't reach OpenAI/);
  // 怎么办只说一遍
  assert.equal(neither.out.match(/need a proxy/g)?.length, 1);
  assert.equal(installedVersion(), "9.9.9");
});

test("下到的包和发布时的不一样（校验不过）：不装，已经装着的那一份不动", () => {
  assert.equal(install().code, 0);
  makeArchive("arm64", "10.0.0");
  writeFileSync(join(release, "v10.0.0", "speakmore-darwin-arm64.tar.xz.sha256"), `${"0".repeat(64)}  x\n`);
  assertRefused(install(), /Checksum mismatch/);
  assert.equal(installedVersion(), "9.9.9");
  assert.deepEqual(readdirSync(home()).sort(), ["app", "bin", "runtime"]);
});

test("下到的程序在这台机器上跑不起来：换掉旧的之前就发现，旧的不动", () => {
  assert.equal(install().code, 0);
  makeArchive("arm64", "10.0.0");
  assertRefused(install({ env: { FAKE_BROKEN: "1" } }), /won't run on this Mac/);
  assert.equal(installedVersion(), "9.9.9");
});

test("正在运行的停不掉：不换（它还开着旧程序的文件）", () => {
  assert.equal(install().code, 0);
  makeArchive("arm64", "10.0.0");
  const result = install({ env: { FAKE_STOP_FAILS: "1" } });
  assertRefused(result, /Couldn't stop the running SpeakMore/);
  assert.equal(installedVersion(), "9.9.9");
});

test("链接的位置上已经有别人的同名文件：不动它，告诉用户用完整路径", () => {
  const theirs = join(userHome, ".local", "bin", "speakmore");
  mkdirSync(join(theirs, ".."), { recursive: true });
  writeFileSync(theirs, "别人的");
  const { code, out } = install();
  assert.equal(code, 0);
  assert.match(out, /is another speakmore; left it alone/);
  assert.equal(readFileSync(theirs, "utf8"), "别人的");
  assert.equal(existsSync(join(home(), "bin", "links")), false);
});

test("PATH 里排在前面的是另一个 speakmore 时提醒一句", () => {
  const other = join(root, "other-bin");
  mkdirSync(other);
  writeFileSync(join(other, "speakmore"), "#!/bin/sh\n");
  chmodSync(join(other, "speakmore"), 0o755);
  const { out } = install({ path: `${other}:${join(userHome, ".local", "bin")}:` });
  assert.match(out, /Another speakmore comes first on your PATH/);
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
  assert.equal(recorded(), custom);
});

test("装过一次以后，再运行安装命令照定位文件装回原处（不用再设 SPEAKMORE_HOME），不在默认位置另装一份", () => {
  const custom = join(root, "elsewhere", ".speakmore");
  mkdirSync(join(root, "elsewhere"));
  assert.equal(install({ env: { SPEAKMORE_HOME: custom } }).code, 0);
  makeArchive("arm64", "10.0.0");
  const { code, out } = install();
  assert.equal(code, 0, out);
  assert.match(out, /Found 9\.9\.9/);
  assert.equal(installedVersion(custom), "10.0.0");
  assert.equal(existsSync(home()), false);
});

test("定位文件坏了：不装，也不改装到默认位置（那样看着像数据丢了），说清楚怎么办", () => {
  mkdirSync(join(locationFile(), ".."), { recursive: true });
  for (const text of ["{ 坏了", '{"home": "relative"}', '{"other": "/x"}']) {
    writeFileSync(locationFile(), text);
    const result = install();
    assertRefused(result, /location file is invalid[\s\S]*Delete it to use the default place/);
    assert.equal(existsSync(home()), false);
  }
  // 指定了装到哪的不看定位文件：0.11.0 的 speakmore update 就是这样调新版本的安装脚本的
  assert.equal(install({ env: { SPEAKMORE_HOME: home() } }).code, 0);
});

test("定位文件说装在一个现在不在的地方（移动硬盘没接）：不在那里新建，也不改装到默认位置", () => {
  mkdirSync(join(locationFile(), ".."), { recursive: true });
  writeFileSync(locationFile(), JSON.stringify({ home: join(root, "unplugged", ".speakmore") }));
  assertRefused(install(), /Can't find the SpeakMore folder[\s\S]*connect the drive/);
  assert.equal(existsSync(join(root, "unplugged")), false);
  assert.equal(existsSync(home()), false);
});

test("启动脚本里不写死路径：整个目录搬到别处、链接改指过去照样能用；外面残留的 SPEAKMORE_HOME 带不偏", () => {
  assert.equal(install().code, 0);
  const launcher = readFileSync(join(home(), "bin", "speakmore"), "utf8");
  assert.equal(launcher.includes(userHome), false, launcher);
  const moved = join(root, "moved home", ".speakmore");
  mkdirSync(join(moved, ".."));
  execFileSync("mv", [home(), moved]);
  const link = join(userHome, ".local", "bin", "speakmore");
  execFileSync("ln", ["-sfn", join(moved, "bin", "speakmore"), link]);
  execFileSync(link, ["status"], {
    env: { PATH: "/usr/bin:/bin", FAKE_CALL_LOG: callLog, SPEAKMORE_HOME: "/old/place/.speakmore" },
  });
  assert.equal(calls().at(-1), `1|${moved}|2|${join(moved, "app", "bin", "speakmore.mjs")} status`);
  // 不经链接、直接从 bin 里运行也一样。这里没有 PWD，shell 算出来的是真实路径（/var 其实是 /private/var），同一个目录
  execFileSync("./speakmore", ["status"], {
    cwd: join(moved, "bin"),
    env: { PATH: "/usr/bin:/bin", FAKE_CALL_LOG: callLog },
  });
  const real = realpathSync(moved);
  assert.equal(calls().at(-1), `1|${real}|2|${join(real, "app", "bin", "speakmore.mjs")} status`);
});

test("0.11.0 及以前装的（启动脚本里写死了路径、没有定位文件）：升级时启动脚本换成新的，定位文件补上，你的东西不动", () => {
  // 照 0.11.0 的安装脚本摆出来的样子
  mkdirSync(join(home(), "bin"), { recursive: true });
  execFileSync("tar", ["-xJf", join(release, "v9.9.9", "speakmore-darwin-arm64.tar.xz"), "-C", home()]);
  const old = `#!/bin/sh\ninstalled_in='${home()}'\nSPEAKMORE_HOME="\${SPEAKMORE_HOME:-$installed_in}"\nexport SPEAKMORE_HOME\nELECTRON_RUN_AS_NODE=1 exec '${home()}/runtime/Electron.app/Contents/MacOS/Electron' '${home()}/app/bin/speakmore.mjs' "$@"\n`;
  writeFileSync(join(home(), "bin", "speakmore"), old);
  chmodSync(join(home(), "bin", "speakmore"), 0o755);
  const link = join(userHome, ".local", "bin", "speakmore");
  mkdirSync(join(link, ".."), { recursive: true });
  execFileSync("ln", ["-s", join(home(), "bin", "speakmore"), link]);
  writeFileSync(join(home(), "bin", "links"), `${link}\n`);
  writeFileSync(join(home(), "settings.json"), '{"hotkey":"fn"}');
  makeArchive("arm64", "10.0.0");

  const { code, out } = install();
  assert.equal(code, 0, out);
  assert.match(out, /Upgraded: 9\.9\.9 → 10\.0\.0/);
  assert.equal(readFileSync(join(home(), "bin", "speakmore"), "utf8").includes(home()), false);
  assert.equal(recorded(), home());
  assert.equal(readFileSync(join(home(), "settings.json"), "utf8"), '{"hotkey":"fn"}');
  assert.equal(readFileSync(join(home(), "bin", "links"), "utf8"), `${link}\n`);
  execFileSync(link, ["status"], { env: { PATH: "/usr/bin:/bin", FAKE_CALL_LOG: callLog } });
  assert.equal(calls().at(-1), `1|${home()}|2|${join(home(), "app", "bin", "speakmore.mjs")} status`);
});

test("记不下装在哪（~/.config 被别的程序占了）：装在默认位置的照常装好、提醒一句；装在别处的照实报错", () => {
  writeFileSync(join(userHome, ".config"), "不是目录");
  const plain = install();
  assert.equal(plain.code, 0, plain.all);
  assert.match(plain.out, /works without it/);
  assert.equal(installedVersion(), "9.9.9");

  const custom = join(root, "custom");
  const elsewhere = install({ env: { SPEAKMORE_HOME: custom } });
  assert.equal(elsewhere.code, 1, elsewhere.all);
  assert.match(elsewhere.err, /Couldn't write[\s\S]*SpeakMore 9\.9\.9 is in/);
  assert.doesNotMatch(elsewhere.err, /Nothing was installed/);
});

/** 把整个目录拷到另一处（speakmore move 做的那一步），符号链接原样 */
function copyHome(from, to) {
  mkdirSync(join(to, ".."), { recursive: true });
  execFileSync("cp", ["-pPR", from, to]);
}

test("换家（speakmore move 拷完以后）：不联网、不换程序；命令的链接和定位文件改指到新目录；再换回去也行", () => {
  assert.equal(install().code, 0);
  const link = join(userHome, ".local", "bin", "speakmore");
  const moved = join(root, "Data", ".speakmore");
  copyHome(home(), moved);
  rmSync(callLog);
  const offline = { SPEAKMORE_INSTALL_BASE: join(root, "nowhere") };
  const { code, out } = install({ env: { ...offline, SPEAKMORE_HOME: moved, SPEAKMORE_PREVIOUS_HOME: home() } });
  assert.equal(code, 0, out);
  assert.match(out, /Copied SpeakMore 9\.9\.9[\s\S]*Moved SpeakMore 9\.9\.9 to/);
  assert.doesNotMatch(out, /Download server reachable/);
  assert.equal(readlinkSync(link), join(moved, "bin", "speakmore"));
  assert.equal(recorded(), moved);
  // 只在新目录里试跑、停过，旧目录的程序没动
  assert.deepEqual(
    calls().map((line) => line.split("|")[1]),
    [moved, moved],
  );
  assert.equal(readFileSync(join(moved, "bin", "links"), "utf8"), `${link}\n`);

  // 搬失败时由 speakmore move 换回去：对旧目录再换一次家
  const back = install({ env: { ...offline, SPEAKMORE_HOME: home(), SPEAKMORE_PREVIOUS_HOME: moved } });
  assert.equal(back.code, 0, back.all);
  assert.equal(readlinkSync(link), join(home(), "bin", "speakmore"));
  assert.equal(recorded(), home());
});

test("换家：新目录里拷过去的程序跑不起来（比如那块盘不让执行）就不改指，原来的照常用", () => {
  assert.equal(install().code, 0);
  const link = join(userHome, ".local", "bin", "speakmore");
  const moved = join(root, "Data", ".speakmore");
  copyHome(home(), moved);
  const result = install({ env: { SPEAKMORE_HOME: moved, SPEAKMORE_PREVIOUS_HOME: home(), FAKE_BROKEN: "1" } });
  assertRefused(result, /won't run on this Mac/);
  assert.equal(readlinkSync(link), join(home(), "bin", "speakmore"));
  assert.equal(recorded(), home());
});

test("换家要和 SPEAKMORE_HOME 一起给；新目录里没有拷过去的程序不换", () => {
  assert.equal(install().code, 0);
  assertRefused(install({ env: { SPEAKMORE_PREVIOUS_HOME: home() } }), /goes with SPEAKMORE_HOME/);
  const empty = join(root, "empty");
  mkdirSync(empty);
  assertRefused(
    install({ env: { SPEAKMORE_HOME: empty, SPEAKMORE_PREVIOUS_HOME: home() } }),
    /has no copy of SpeakMore/,
  );
  assert.equal(recorded(), home());
});

test("从拼好的树装（speakmore update）：不联网，家目录里 .update- 开头的那个改名换上，原来的东西不动", () => {
  assert.equal(install().code, 0);
  writeFileSync(join(home(), "settings.json"), '{"hotkey":"fn"}');
  const tree = makeTree("10.0.0");
  const prepared = join(home(), ".update-10.0.0-0badf00d");
  execFileSync("mv", [tree, prepared]);
  // 下载地址指到一个不存在的地方：从拼好的树装不该去问
  const { code, out } = install({
    env: { SPEAKMORE_INSTALL_FROM: prepared, SPEAKMORE_INSTALL_BASE: join(root, "nowhere") },
    args: ["--no-start"],
  });
  assert.equal(code, 0, out);
  assert.match(out, /Prepared SpeakMore 10\.0\.0/);
  assert.doesNotMatch(out, /Download server reachable/);
  assert.equal(installedVersion(), "10.0.0");
  assert.equal(readFileSync(join(home(), "settings.json"), "utf8"), '{"hotkey":"fn"}');
  assert.deepEqual(
    readdirSync(home()).sort(),
    ["app", "bin", "runtime", "settings.json"],
    "拼好的那个目录换进去以后不留",
  );
});

test("从拼好的树装：只认家目录里 .update- 开头的目录；别处的、不存在的、跑不起来的都不装", () => {
  assert.equal(install().code, 0);
  const elsewhere = makeTree("10.0.0");
  assertRefused(install({ env: { SPEAKMORE_INSTALL_FROM: elsewhere } }), /must be a \.update- folder inside/);
  assertRefused(install({ env: { SPEAKMORE_INSTALL_FROM: join(home(), ".update-10.0.0-missing") } }), /No such folder/);
  const prepared = join(home(), ".update-10.0.0-0badf00d");
  execFileSync("mv", [elsewhere, prepared]);
  assertRefused(install({ env: { SPEAKMORE_INSTALL_FROM: prepared, FAKE_BROKEN: "1" } }), /won't run on this Mac/);
  assert.equal(installedVersion(), "9.9.9");
});

test("从拼好的树装：家目录写成 a//b、末尾带 /、经过符号链接，都认得出是它里面的；用 .. 绕出去的不认", () => {
  assert.equal(install().code, 0);
  const prepared = join(home(), ".update-10.0.0-0badf00d");
  execFileSync("mv", [makeTree("10.0.0"), prepared]);
  // 家目录经过一个符号链接、写法又不规整；交来的是真实路径（speakmore update 规范化过的）
  const linked = join(root, "linked-home");
  execFileSync("ln", ["-s", userHome, linked]);
  const messy = `${linked}//.speakmore/`;
  const { code, out } = install({
    env: { SPEAKMORE_HOME: messy, SPEAKMORE_INSTALL_FROM: prepared },
    args: ["--no-start"],
  });
  assert.equal(code, 0, out);
  assert.equal(installedVersion(), "10.0.0");

  const outside = makeTree("10.0.1");
  mkdirSync(join(home(), ".update-10.0.1-0badf00d"));
  const sneaky = join(home(), ".update-10.0.1-0badf00d", "..", "..", "..", outside.split("/").at(-1));
  assertRefused(install({ env: { SPEAKMORE_INSTALL_FROM: sneaky } }), /must be a \.update- folder inside/);
  assert.ok(existsSync(join(outside, "app", "package.json")), "绕出去的那个目录没被删");
  assert.equal(installedVersion(), "10.0.0");
});

test("0.11.0 以前的版本（包是 tar.gz）不装：说清楚怎么办；0.10.0 及以前的 speakmore update 就是这么指定 v0.10.1 的", () => {
  const result = install({ env: { SPEAKMORE_VERSION: "v0.10.1" } });
  assertRefused(result, /can't install v0\.10\.1[\s\S]*packaged differently[\s\S]*v0\.10\.1\/SpeakMore-arm64\.dmg/);
  assert.equal(existsSync(join(home(), "app")), false);
});

test("从拼好的树装：只是改名换上，磁盘剩得不多也装（拼的时候已经占过地方了）", () => {
  assert.equal(install().code, 0);
  const prepared = join(home(), ".update-10.0.0-0badf00d");
  execFileSync("mv", [makeTree("10.0.0"), prepared]);
  const { code, out } = install({
    env: { SPEAKMORE_INSTALL_FROM: prepared, FAKE_FREE_KB: String(300 * 1024) },
    args: ["--no-start"],
  });
  assert.equal(code, 0, out);
  assert.equal(installedVersion(), "10.0.0");
  // 下载安装照旧要查
  assertRefused(install({ env: { FAKE_FREE_KB: String(300 * 1024) } }), /Not enough disk space/);
});

test("不认识的参数：不装", () => {
  assertRefused(install({ args: ["--force"] }), /Unknown option: --force/);
  assert.equal(existsSync(home()), false);
});

test("脚本给人看的话都是英文：除了注释，一个汉字都没有", () => {
  const lines = readFileSync(INSTALLER, "utf8").split("\n");
  const chinese = lines
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => !/^\s*#/.test(line) && /\p{Script=Han}/u.test(line));
  assert.deepEqual(chinese, []);
});
