import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chooseHome, needsHomeChoice } from "../../src/app/first-run.mjs";
import { createTranslator } from "../../src/i18n/index.mjs";
import { locationFileOf, readLocation } from "../../src/storage/location.mjs";

// Mac 的 App 第一次打开时问存储位置（app/first-run.mjs）：什么时候问、选了以后记下什么。
// 系统的对话框换成假的：按顺序交回预先给的回答，记下弹过什么

const posixOnly = { skip: process.platform === "win32" && "第一次打开时问存储位置只在 macOS 上" };
const t = createTranslator("zh-CN");

function scratch(t) {
  const root = realpathSync(mkdtempSync("/tmp/sm-f-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** 假的对话框：boxes 是每次提示框按下的按钮，folders 是每次选文件夹选的（null 是取消） */
function fakeDialog({ boxes = [], folders = [] }) {
  const shown = [];
  return {
    shown,
    async showMessageBox(options) {
      shown.push(options.message);
      return { response: boxes.shift() ?? 0 };
    },
    async showOpenDialog() {
      shown.push("选文件夹");
      const folder = folders.shift() ?? null;
      return folder === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [folder] };
    },
  };
}

const choose = (userHome, dialog, extra = {}) =>
  chooseHome({ dialog, t, env: {}, userHome, platform: "darwin", ...extra });

test("什么时候问：Mac 上打成应用、从程序坞打开、什么都还没装过（没有定位文件、默认位置、0.1 版的旧数据）", (t) => {
  const userHome = scratch(t);
  const base = { env: {}, platform: "darwin", packaged: true, launchedByCli: false, userHome };
  assert.equal(needsHomeChoice(base), true);
  assert.equal(needsHomeChoice({ ...base, platform: "win32" }), false);
  assert.equal(needsHomeChoice({ ...base, packaged: false }), false);
  assert.equal(needsHomeChoice({ ...base, launchedByCli: true }), false);
  assert.equal(needsHomeChoice({ ...base, env: { SPEAKMORE_HOME: "/x" } }), false);
  mkdirSync(join(userHome, "Library", "Application Support", "SpeakMore"), { recursive: true });
  assert.equal(needsHomeChoice(base), false, "0.1 版的老用户");
  rmSync(join(userHome, "Library"), { recursive: true });
  mkdirSync(join(userHome, ".speakmore"));
  assert.equal(needsHomeChoice(base), false, "装过了");
  rmSync(join(userHome, ".speakmore"), { recursive: true });
  writeFileSync(join(userHome, "location"), "");
  assert.equal(needsHomeChoice({ ...base, exists: (path) => path === locationFileOf({}, userHome, "darwin") }), false);
});

test("选默认位置：什么都不写", posixOnly, async (t) => {
  const userHome = scratch(t);
  const dialog = fakeDialog({ boxes: [0] });
  assert.equal(await choose(userHome, dialog), join(userHome, ".speakmore"));
  assert.equal(existsSync(locationFileOf({}, userHome, "darwin")), false);
  assert.equal(existsSync(join(userHome, ".speakmore")), false);
  assert.match(dialog.shown[0], /选择存储位置/);
});

test("选了别处：建好那里的 .speakmore（只让自己进），记进定位文件", posixOnly, async (t) => {
  const userHome = scratch(t);
  const disk = join(userHome, "disk");
  mkdirSync(disk);
  const home = await choose(userHome, fakeDialog({ boxes: [1], folders: [disk] }));
  assert.equal(home, join(disk, ".speakmore"));
  assert.equal(readLocation(locationFileOf({}, userHome, "darwin"), "darwin"), home);
  assert.equal(existsSync(home), true);
});

test("取消选文件夹、选的地方不能用：回到第一步再问；选了用户目录本身就是默认位置", posixOnly, async (t) => {
  const userHome = scratch(t);
  const full = join(userHome, "full");
  mkdirSync(join(full, ".speakmore"), { recursive: true });
  writeFileSync(join(full, ".speakmore", "notes.txt"), "别人的");
  const dialog = fakeDialog({ boxes: [1, 1, 0, 1], folders: [null, full, userHome] });
  assert.equal(await choose(userHome, dialog), join(userHome, ".speakmore"));
  assert.deepEqual(dialog.shown, [
    "选择存储位置",
    "选文件夹",
    "选择存储位置",
    "选文件夹",
    "此位置不可用",
    "选择存储位置",
    "选文件夹",
  ]);
  assert.equal(existsSync(locationFileOf({}, userHome, "darwin")), false);
});

test("选的地方已经有一份 SpeakMore（重装系统前放在移动硬盘上的）：问一句，沿用它", posixOnly, async (t) => {
  const userHome = scratch(t);
  const disk = join(userHome, "disk");
  mkdirSync(join(disk, ".speakmore"), { recursive: true });
  writeFileSync(join(disk, ".speakmore", "settings.json"), "{}");
  const dialog = fakeDialog({ boxes: [1, 0], folders: [disk] });
  assert.equal(await choose(userHome, dialog), join(disk, ".speakmore"));
  assert.match(dialog.shown.at(-1), /已有 SpeakMore 的数据/);
  assert.equal(readLocation(locationFileOf({}, userHome, "darwin"), "darwin"), join(disk, ".speakmore"));
});

test("那块盘不行（exFAT 这类）、路径太长：说清楚，再选一次", posixOnly, async (t) => {
  const userHome = scratch(t);
  const disk = join(userHome, "disk");
  mkdirSync(disk);
  const long = join(userHome, "x".repeat(90));
  mkdirSync(long);
  const dialog = fakeDialog({ boxes: [1, 0, 1, 0, 0], folders: [disk, long] });
  const probe = async () => {
    throw new Error("exFAT");
  };
  assert.equal(await choose(userHome, dialog, { probe }), join(userHome, ".speakmore"));
  assert.equal(dialog.shown.filter((message) => message === "此位置不可用").length, 2);
  assert.equal(existsSync(locationFileOf({}, userHome, "darwin")), false);
});
