import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  safeStorage,
  screen,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { ALREADY_RUNNING_EXIT_CODE, startControlServer } from "../control.mjs";
import { alsoLogTo, log } from "../log.mjs";
import { findProvider, formatModelChoice, PROVIDERS, parseModelChoice } from "../server/providers/index.mjs";
import { openHistory } from "../storage/history.mjs";
import { migrateLegacyData } from "../storage/legacy.mjs";
import { ensureHome, keyFile, resolvePaths } from "../storage/paths.mjs";
import { HOTKEY_KEYCAPS, HOTKEYS, overridingEnv, resolveSettings, saveSetting } from "../storage/settings.mjs";
import { toHex } from "../themes/color.mjs";
import { themeCss } from "../themes/contract.mjs";
import { findTheme, THEMES } from "../themes/index.mjs";
import { insights } from "../usage/insights.mjs";
import { usageReport } from "../usage/report.mjs";
import { createDelivery } from "./delivery.mjs";
import { startHelper } from "./helper.mjs";
import { createKeyManager } from "./keys/key-manager.mjs";
import { createKeyStore } from "./keys/key-store.mjs";
import { startService } from "./service.mjs";
import { summarizeSetup } from "./setup-state.mjs";

// 后台应用的主进程：两个窗口（悬浮条、主窗口）、菜单栏图标、原生小帮手、内置的听写服务，
// 以及页面和命令行要它代办的事。窗口用什么颜色由主题定（src/themes），这里负责把它交给每个窗口。
// 平时由 speakmore 命令启动（src/cli），也可以打成应用双击启动。
// 结构对应原版的"主进程 + 悬浮条 + 主窗口（hub）+ 键盘子进程"（targets/typeless/docs/03-process-architecture.md）。

/** 调试用：设了就连这个地址上单独启动的服务端，不启动内置的那个 */
const EXTERNAL_SERVER_URL = process.env.SPEAKMORE_SERVER_URL ?? null;
/** 是 speakmore 命令启动的：日志由它接到文件里，缺什么也由它在终端里说，这边不自己弹主窗口 */
const LAUNCHED_BY_CLI = process.env.SPEAKMORE_CLI === "1";

let PATHS;
let SETTINGS;
try {
  PATHS = resolvePaths(process.env);
  SETTINGS = resolveSettings({ file: PATHS.settingsFile, env: process.env });
} catch (error) {
  // 路径或设置写错是使用上的问题，说一句人话就退出，不留一个按了热键没反应的进程
  console.error(error.message);
  process.exit(2);
}
/** 现在用哪个键。设置里可以当场换（setup:set-hotkey），换的时候重启小帮手 */
let hotkey = SETTINGS.hotkey.value;
/** 启动时用哪一家的哪个模型整理。之后可以在设置里改用别家（keys.use），正在用的以 keys.provider 为准 */
const MODEL = parseModelChoice(SETTINGS.model.value);
const PROVIDER = findProvider(MODEL.provider);
/** 思考档位只有 Gemini 有；别家用不上时是 null，状态里也不报 */
const thinkingFor = (provider) => (provider.thinkingLevels ? SETTINGS.thinking.value : null);
const hotkeyLabel = () => HOTKEYS[hotkey];
/** 菜单栏图标：印章上的五道声波。文件名带 Template，系统按菜单栏的深浅反色；@2x 那张由系统自己挑（scripts/build/make-icon.sh） */
const TRAY_ICON = join(import.meta.dirname, "../../assets/trayTemplate.png");
/** 关于里"在 GitHub 上看"打开的地方 */
const HOMEPAGE = "https://github.com/zephyr4123/speakmore";
/** 主窗口的大小，照原版（targets/typeless 的 hub 窗口：1080×750，最小 988×685） */
const HUB_SIZE = { width: 1080, height: 750, minWidth: 988, minHeight: 685 };
/** 悬浮条的窗口。比条本身大一圈：上面要放一行提示，四周要留出阴影，报错时条会变宽变高 */
const BAR_SIZE = { width: 380, height: 124 };
/** 系统设置里三项权限各自的页面 */
const PRIVACY_PANES = {
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  listen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
  trusted: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
};

// 所有东西都放在 paths.mjs 定的那一个目录里，命令行和这里用同一处。Electron 默认会按应用名在
// ~/Library/Application Support 下另开一个目录放 Chromium 的缓存和状态，把它也收进来，和我们的数据分开放
app.setPath("userData", PATHS.cacheDir);

// 打成应用后没有终端，日志自己写文件。由命令启动时标准输出已经被接到同一个文件里了
if (app.isPackaged) alsoLogTo(PATHS.logFile);

// 同一个家目录只跑一个。这里给的数据会随 second-instance 事件送到已经在运行的那一个手里
const isOnlyInstance = app.requestSingleInstanceLock({ byCli: LAUNCHED_BY_CLI });
if (!isOnlyInstance) {
  console.error("已经有一个在运行了");
  // 约定的退出码：启动它的 speakmore 命令据此知道"不是没起来，是有别的先起来了"，接着等那一个
  app.exit(ALREADY_RUNNING_EXIT_CODE);
}

const sourceDir = join(app.getAppPath(), "src");
const webPreferences = { preload: join(sourceDir, "preload", "preload.cjs"), sandbox: true, contextIsolation: true };

// 不能写成顶层的 await app.whenReady()：Electron 要等主模块加载完才会就绪，
// 而顶层 await 让模块一直加载不完，两边互相等（Electron 44.7 实测如此）。
// 没抢到锁的那个正在退出，不往下走：家目录里的东西（进程号、控制通道）都是先到的那个的
if (isOnlyInstance) {
  app
    .whenReady()
    .then(main)
    .catch((error) => {
      // 启动失败时没有窗口可以报错，记下来并以非零码退出，不留一个什么都不干的进程
      log.error("startup_failed", { error: String(error?.stack ?? error) });
      app.exit(1);
    });
}

async function main() {
  app.dock?.hide();

  ensureHome(PATHS);
  // 记下进程号：万一卡住了不答话，speakmore stop 靠它找到这个进程。要赶在控制通道开始听之前写好，
  // 这样只要通道连得上，文件里记的就一定是通道那头的进程
  writeFileSync(PATHS.pidFile, `${process.pid}\n`);
  // 0.1 版的数据在别处。平时是 speakmore 命令在启动之前搬好的；直接双击应用启动时由这里搬
  await migrateLegacyData({ paths: PATHS, log });

  const startedAt = new Date().toISOString();
  const history = openHistory(PATHS.historyDb);
  // 每家一把 key，各存一个文件。正在用的那家之外的也要在：speakmore key openai、model check 要用
  const keyStores = Object.fromEntries(
    PROVIDERS.map(({ id }) => [
      id,
      createKeyStore({ file: keyFile(PATHS, id, { packaged: app.isPackaged }), safeStorage }),
    ]),
  );
  // 档位按设置原样给：正在用的那家用不上，但拿 Gemini 的 key 去检查、给 Gemini 存 key 时要用它。
  // 每次调模型记一笔账，开着的历史窗口跟着更新花费（记账出错由整理流程写日志，不连累听写）
  const service = EXTERNAL_SERVER_URL
    ? null
    : await startService({
        log,
        model: MODEL,
        thinkingLevel: SETTINGS.thinking.value,
        onModelCall: (call) => {
          history.addCall(call);
          historyChanged();
        },
      });
  const serverUrl = EXTERNAL_SERVER_URL ?? service.url;
  const e2e = process.env.SPEAKMORE_E2E_OUT ? await import("./e2e.mjs") : null;

  const keys = createKeyManager({
    service,
    provider: PROVIDER,
    keyStores,
    env: process.env,
    log,
    onChange: () => setupChanged(),
  });
  /** 按键监听的小帮手：starting（还没报上来）/ running / stopped（退出了，或者根本没起来） */
  let helperState = "starting";
  /** 小帮手报上来的两项权限；它没在 running 时是 null */
  let helperPermissions = null;
  /** 控制通道，启动到后面才开；端到端测试时一直是 null */
  let control = null;
  /** 启动时对麦克风和 key 的检查做完了没有 */
  let startupChecked = false;
  let hubWindow = null;
  let onboardingWindow = null;
  /** 首次引导正在测快捷键：热键送到引导窗口，不去开悬浮条 */
  let hotkeyToOnboarding = false;
  log.info("started", {
    version: app.getVersion(),
    hotkey,
    model: SETTINGS.model.value,
    thinking: thinkingFor(PROVIDER),
    theme: SETTINGS.theme.value,
    home: PATHS.home,
    server_url: serverUrl,
    packaged: app.isPackaged,
    by_cli: LAUNCHED_BY_CLI,
    e2e: Boolean(e2e),
  });

  // ---------- 能不能用、还差什么 ----------

  /** 正在用的那一家：连着单独启动的服务端时是设置里那家（用哪个由那边定，这里只是个名字） */
  const provider = () => (service ? keys.provider : PROVIDER);

  const currentSetup = () => ({
    providerName: provider().name,
    key: keys.current,
    helper: helperState,
    permissions: {
      microphone: systemPreferences.getMediaAccessStatus("microphone"),
      listen: helperPermissions?.listen ?? null,
      trusted: helperPermissions?.trusted ?? null,
    },
  });

  let offeredSettings = LAUNCHED_BY_CLI;
  /**
   * 还缺东西就打开首次引导，第一次启动的人不用猜下一步该干什么。只主动弹一次。
   * 由命令启动时不弹：那个人正看着终端，突然冒出一个窗口还会把他正要粘贴 key 的焦点抢走。
   * 几样检查是先后到的（key 要验证、小帮手要启动），都有了结论才判断，免得刚启动就误报。
   */
  function offerSettingsIfIncomplete() {
    const setup = currentSetup();
    if (offeredSettings || !startupChecked || setup.key.state === "checking" || setup.permissions.listen === null)
      return;
    const summary = summarizeSetup(setup);
    if (summary.missing.length === 0 && summary.degraded === null) return;
    offeredSettings = true;
    log.info("settings_offered", { missing: summary.missing, degraded: summary.degraded !== null });
    showOnboarding();
  }

  /** 上面任何一样变了都调一次：菜单栏和主窗口跟着更新 */
  function setupChanged() {
    refreshTrayMenu();
    hubWindow?.webContents.send("setup:changed");
    onboardingWindow?.webContents.send("setup:changed");
  }

  // ---------- 主题 ----------

  let theme = findTheme(SETTINGS.theme.value);
  // 每个窗口的预加载脚本一上来就同步来取，赶在页面画出第一帧之前
  ipcMain.on("theme:get", (event) => {
    event.returnValue = themeCss(theme);
  });
  /** 重新读一遍设置里的主题，开着的窗口当场换。别的设置要重启才生效，主题不用 */
  function reloadTheme() {
    theme = findTheme(resolveSettings({ file: PATHS.settingsFile, env: process.env }).theme.value);
    const css = themeCss(theme);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("theme:changed", css);
    log.info("theme_changed", { theme: theme.id });
    return { theme: theme.id };
  }
  /** 窗口还没画出页面时的底色：和页面的底一样，免得深色模式下先闪一下白 */
  const windowBackground = () => toHex(theme.window[nativeTheme.shouldUseDarkColors ? "dark" : "light"].bg);

  // ---------- 悬浮条 ----------

  function createBar() {
    const { workArea } = screen.getPrimaryDisplay();
    const bar = new BrowserWindow({
      ...BAR_SIZE,
      x: Math.round(workArea.x + (workArea.width - BAR_SIZE.width) / 2),
      // 贴着屏幕可用区域的底边。条离底边多远由 bar.css 定
      y: workArea.y + workArea.height - BAR_SIZE.height,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // 不能抢焦点：焦点一旦离开用户正在用的输入框，文字就贴不进去了
      focusable: false,
      webPreferences,
    });
    // 整个窗口都点不到，鼠标事件原样落到它下面的应用上。条上的两个按钮不靠这个窗口收点击：
    // 点击一旦落在我们的窗口上，系统就会把我们切到最前面（面板类型的窗口也一样，实测过），输入框照样丢焦点。
    // 所以点击是原生小帮手在事件到达任何窗口之前截下来的，见下面的 bar:capture
    bar.setIgnoreMouseEvents(true);
    bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    bar.loadFile(join(sourceDir, "renderer", "bar", "bar.html"));
    return bar;
  }

  const bar = createBar();
  /** 给悬浮条的页面发消息。退出途中窗口已经销毁，这时再发会抛错 */
  const tellBar = (channel, payload) => {
    if (!bar.isDestroyed()) bar.webContents.send(channel, payload);
  };
  const notify = (message) => tellBar("notice", message);
  ipcMain.on("bar:set-visible", (_event, visible) => {
    if (visible) {
      bar.showInactive();
      return;
    }
    bar.hide();
    // 条不在屏幕上时什么都不该截着。页面自己会说"不截了"，这里再说一遍是保险：
    // 万一它漏说了，esc 会一直被吞掉，在哪个应用里都按不出来
    helper.release();
  });
  // 页面崩了就更没人说"不截了"
  bar.webContents.on("render-process-gone", (_event, details) => {
    log.error("bar_gone", { reason: details.reason });
    helper.release();
  });
  // 听写进行中，页面让小帮手把 esc 和条上两个按钮的点击截下来（null 是不截了）。
  // 页面给的是按钮在窗口里的位置，小帮手要的是在屏幕上的位置
  ipcMain.on("bar:capture", (_event, regions) => {
    if (regions === null) {
      helper.release();
      return;
    }
    if (!Array.isArray(regions)) {
      log.error("bar_capture_invalid", { type: typeof regions });
      return;
    }
    const origin = bar.getBounds();
    const onScreen = regions.map(({ id, x, y, width, height }) => ({
      id,
      x: origin.x + x,
      y: origin.y + y,
      width,
      height,
    }));
    // "点了按钮没反应"时先看这条：位置对不对得上屏幕上画的那两个圆
    log.info("bar_capture", { regions: onScreen });
    helper.capture(onScreen);
  });

  // ---------- 按键和贴字 ----------

  let helper = null;
  /** 每启动一个小帮手加一；旧的那个退出时发来的事件靠它认出来并丢掉 */
  let helperGeneration = 0;
  /** 小帮手截不截得住 esc 和点击（要辅助功能权限）。截不住时悬浮条不画那两个按钮 */
  let barControls = false;
  function setBarControls(enabled) {
    barControls = enabled;
    tellBar("bar:controls", enabled);
  }

  /**
   * @param {{ prompt: boolean }} options prompt：两项权限没给时让不让系统弹授权框。只在应用启动时弹一次；
   *   之后重新检查权限靠的是重启小帮手，那时再弹的话每查一次弹一次
   */
  function launchHelper({ prompt }) {
    const generation = ++helperGeneration;
    helperPermissions = null;
    helperState = "starting";
    setBarControls(false);
    helper = startHelper(join(app.getAppPath(), "build", "key-helper"), {
      args: ["--key", hotkey, ...(prompt ? [] : ["--no-prompt"])],
      onEvent: (event) => {
        if (generation === helperGeneration) onHelperEvent(event);
      },
      log,
    });
  }

  function onHelperEvent(event) {
    switch (event.event) {
      case "ready":
        helperState = "running";
        helperPermissions = { listen: event.listen, trusted: event.trusted };
        log.info("helper_ready", { ...helperPermissions, capture: event.capture });
        setBarControls(event.capture === true);
        setupChanged();
        offerSettingsIfIncomplete();
        break;
      case "hotkey":
      case "other_key": {
        // 首次引导正在测快捷键：热键只送到引导窗口
        if (event.event === "hotkey" && hotkeyToOnboarding && onboardingWindow) {
          onboardingWindow.webContents.send("onboarding:hotkey", { down: event.down });
          break;
        }
        // 热键不灵时先看这条日志有没有：没有就是小帮手没收到按键（权限或键选错了）
        log.info("key_event", { event: event.event, down: event.down });
        const { blocker } = summarizeSetup(currentSetup());
        if (blocker === null) tellBar("input", event);
        else if (event.event === "hotkey" && event.down) notify(blocker);
        break;
      }
      case "escape":
      case "click":
        // 只在听写进行中才会有：那时页面让小帮手把它们截下来了
        // 字段不能叫 event：日志这一条的名字就记在 event 里，会被盖掉
        log.info("bar_input", { input: event.event, id: event.id });
        tellBar("input", event);
        break;
      case "exit":
        helperState = "stopped";
        helperPermissions = null;
        setBarControls(false);
        log.error("helper_exited", { code: event.code, signal: event.signal });
        setupChanged();
        notify(`按键监听停了，${hotkeyLabel()}失效：重启 SpeakMore 试试`);
        break;
      default:
        log.warn("helper_unknown_event", { event: event.event });
    }
  }

  // 端到端测试时不启动小帮手：不听真键盘，也绝不往用户当前的窗口里贴字
  if (e2e) helper = e2e.fakeHelper;
  else launchHelper({ prompt: true });

  // ---------- 页面要主进程代办的事 ----------

  const delivery = createDelivery({
    recordingsDir: PATHS.recordingsDir,
    history,
    paste: (text) => helper.paste(text),
    writeClipboard: (text) => clipboard.writeText(text),
    log,
  });
  function historyChanged() {
    hubWindow?.webContents.send("history:changed");
  }

  ipcMain.handle("config:get", () => ({ serverUrl, hotkeyKeycap: HOTKEY_KEYCAPS[hotkey], barControls }));
  ipcMain.handle("dictation:deliver", async (_event, payload) => {
    const result = await delivery.completed(payload);
    // 只记长度：成品是用户说的话，不进日志
    log.info("delivered", { audio_id: payload.audioId, text_length: payload.text.length, notice: result.notice });
    historyChanged();
    e2e?.onFinished({ delivered: payload.text, notice: result.notice });
    return result;
  });
  ipcMain.handle("dictation:failed", (_event, payload) => {
    delivery.failed(payload);
    log.warn("dictation_failed", { audio_id: payload.audioId, error: payload.error });
    historyChanged();
    e2e?.onFinished({ failed: payload.error });
  });
  ipcMain.handle("history:list", () => history.list());
  ipcMain.handle("usage:report", () => usageReport(history, { now: new Date() }));
  ipcMain.handle("insights:get", () => insights(history.dictations(), { now: new Date() }));
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    hotkeyKeycap: HOTKEY_KEYCAPS[hotkey],
    dataDir: dirname(PATHS.historyDb),
  }));
  ipcMain.handle("app:open-homepage", () => shell.openExternal(HOMEPAGE));
  ipcMain.handle("clipboard:write", (_event, text) => {
    if (typeof text !== "string") throw new TypeError("要复制的不是文字");
    clipboard.writeText(text);
  });

  // ---------- 主窗口的设置要主进程代办的事 ----------

  ipcMain.handle("setup:get", () => {
    const setup = currentSetup();
    return {
      ...setup,
      summary: summarizeSetup(setup),
      hotkey: {
        value: hotkey,
        keycap: HOTKEY_KEYCAPS[hotkey],
        choices: Object.entries(HOTKEYS).map(([id, label]) => ({ id, label })),
      },
      theme: { value: theme.id, choices: THEMES.map(({ id, name }) => ({ id, name })) },
      // 开机启动登记的是"这个应用"；从终端启动时登记上去的会是 Electron 本身，所以只在装成应用后开放
      openAtLogin: { supported: app.isPackaged, enabled: app.getLoginItemSettings().openAtLogin },
      home: PATHS.home,
      version: app.getVersion(),
      // 正在用的那一家；设置里还列出别家，可以给它们填 key、改用它们
      provider: describeProvider(provider()),
      providers: PROVIDERS.map(describeProvider),
      // 连着单独启动的服务端时用哪家由那边定，这里换不了
      switchable: Boolean(service),
    };
  });
  /** 设置里要的一家的说明，带着它的 key 在哪（env / stored / null，不解密） */
  function describeProvider(found) {
    const sources = service ? keys.sources() : {};
    return {
      id: found.id,
      name: found.name,
      keyEnv: found.keyEnv,
      site: found.keySite,
      key: sources[found.id] ?? null,
    };
  }
  // 设置里和 speakmore key 存 key、删 key，走的是同一处
  ipcMain.handle("setup:save-key", (_event, value) => keys.save(value));
  ipcMain.handle("setup:forget-key", (_event, id) => keys.forget({ provider: id ?? keys.provider.id }));
  ipcMain.handle("setup:use-provider", (_event, id, value) => useProvider(id, value));
  ipcMain.handle("setup:read-clipboard", () => clipboard.readText());
  ipcMain.handle("setup:open-key-page", (_event, id) => shell.openExternal((findProvider(id) ?? provider()).keyPage));

  /**
   * 改用另一家（可以顺带填一把它的新 key）：验证过才换，换了就记进设置，下次启动也用它。
   * 当场换，不重启后台：用哪家、哪把 key 都在内置服务里，换掉它们就够了
   * @returns {Promise<{ ok: boolean, problem?: string, note?: string }>}
   */
  async function useProvider(id, value) {
    const result = await keys.use({ provider: id, key: value });
    if (!result.ok) return result;
    const choice = service.model;
    log.info("model_switched", { model: formatModelChoice(choice), by: "settings" });
    try {
      saveSetting(PATHS.settingsFile, "model", choice.provider);
    } catch (error) {
      log.error("settings_save_failed", { name: "model", error: String(error?.message ?? error) });
      return {
        ok: true,
        note: `已改用 ${keys.provider.name}，但没存进设置（${error.message}）· 下次启动换回原来那家`,
      };
    }
    const variable = overridingEnv("model", process.env);
    if (variable !== null) {
      return { ok: true, note: `环境变量 ${variable} 优先 · 下次启动仍按它` };
    }
    return { ok: true };
  }
  ipcMain.handle("setup:open-privacy", async (_event, permission) => {
    if (!Object.hasOwn(PRIVACY_PANES, permission)) throw new TypeError(`不认识的权限：${permission}`);
    // 麦克风从没问过时，系统设置的列表里还没有这个应用，要先让系统弹一次授权框
    if (permission === "microphone" && systemPreferences.getMediaAccessStatus("microphone") === "not-determined") {
      await systemPreferences.askForMediaAccess("microphone");
      setupChanged();
      return;
    }
    await shell.openExternal(PRIVACY_PANES[permission]);
  });
  /** 两项系统权限是小帮手启动时查的，授权之后要重启它才看得到。它停了的话，这也是把它重新拉起来的办法 */
  function recheckPermissions() {
    if (!e2e) {
      helper.stop();
      launchHelper({ prompt: false });
    }
    setupChanged();
  }
  /** 启动时没连上网、先用着的 key，在后台再验一次。不等结果：没网时一等就是几十秒 */
  function reverifyKeyInBackground() {
    keys.reverify().catch((error) => log.error("key_reverify_failed", { error: String(error?.stack ?? error) }));
  }
  ipcMain.handle("setup:recheck", () => {
    recheckPermissions();
    reverifyKeyInBackground();
  });
  ipcMain.handle("setup:set-open-at-login", (_event, enabled) => {
    if (!app.isPackaged) throw new Error("从终端启动时不能设置开机启动");
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    log.info("open_at_login", { enabled: Boolean(enabled) });
    setupChanged();
  });
  ipcMain.handle("setup:set-hotkey", (_event, wanted) => setHotkey(wanted));
  ipcMain.handle("setup:set-theme", (_event, wanted) => {
    saveSetting(PATHS.settingsFile, "theme", wanted);
    reloadTheme();
    setupChanged();
  });

  /**
   * 当场换热键：记进设置，重启小帮手让它听新的键，悬浮条的提示、菜单栏跟着换。不用重启整个应用
   * @returns {{ note?: string }} 有话要交代时（被环境变量盖着）带一句
   */
  function setHotkey(wanted) {
    if (!Object.hasOwn(HOTKEYS, wanted)) throw new TypeError(`不认识的热键：${wanted}`);
    saveSetting(PATHS.settingsFile, "hotkey", wanted);
    if (wanted !== hotkey) {
      hotkey = wanted;
      log.info("hotkey_changed", { hotkey });
      // 和重新检查权限一样：先停旧的再起新的，旧的那个退出时的事件靠代数作废
      if (!e2e) {
        helper.stop();
        launchHelper({ prompt: false });
      }
      tellBar("bar:hotkey", HOTKEY_KEYCAPS[hotkey]);
      historyChanged();
      setupChanged();
    }
    const variable = overridingEnv("hotkey", process.env);
    return variable === null ? {} : { note: `环境变量 ${variable} 优先 · 下次启动仍按它` };
  }

  // ---------- 菜单栏、主窗口和首次引导 ----------

  /**
   * 打开主窗口（已经开着就亮出来），可以顺带指定去哪一页。
   * @param {{ route?: "home" | "history", pane?: string }} [target] pane：设置里的哪一页，"auto" 是还差东西的那一页
   */
  function showHub(target = {}) {
    if (hubWindow === null) {
      hubWindow = createHub(target);
    } else if (target.route || target.pane) {
      hubWindow.webContents.send("hub:navigate", target);
    }
    hubWindow.show();
    // 这是个没有程序坞图标的应用，不主动要一下焦点的话窗口会开在别的应用后面
    app.focus({ steal: true });
  }

  function createHub(target) {
    const window = new BrowserWindow({
      ...HUB_SIZE,
      title: "SpeakMore",
      backgroundColor: windowBackground(),
      // 和原版一样把标题栏藏起来，红绿灯放进侧栏的左上角
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 26, y: 24 },
      webPreferences,
    });
    // 第一次打开时去哪一页写在地址里：页面加载完之前发消息是收不到的
    const query = Object.fromEntries(Object.entries(target).filter(([, value]) => value));
    window.loadFile(join(sourceDir, "renderer", "hub", "hub.html"), { query });
    window.on("focus", () => {
      // 切回来时重读一遍：窗口开着过了夜，"今天"要换成新的一天；用户去系统设置里改完权限再切回来，状态跟着刷新
      window.webContents.send("history:changed");
      window.webContents.send("setup:changed");
    });
    window.on("closed", () => {
      hubWindow = null;
    });
    return window;
  }

  /** 首次引导（原版的 onboarding 窗口）：和主窗口一样大，红绿灯的位置照原版 */
  function showOnboarding() {
    if (onboardingWindow === null) {
      onboardingWindow = new BrowserWindow({
        ...HUB_SIZE,
        title: "SpeakMore",
        backgroundColor: windowBackground(),
        titleBarStyle: "hidden",
        trafficLightPosition: { x: 20, y: 16 },
        webPreferences,
      });
      onboardingWindow.loadFile(join(sourceDir, "renderer", "onboarding", "onboarding.html"));
      onboardingWindow.on("focus", () => {
        // 用户多半是去系统设置里打开了开关再切回来：两项权限要重启小帮手才看得到。
        // 都给了就不重启，免得测快捷键、说话时小帮手平白断一下
        const { listen, trusted } = helperPermissions ?? {};
        if (listen !== true || trusted !== true) recheckPermissions();
        else setupChanged();
      });
      onboardingWindow.on("closed", () => {
        onboardingWindow = null;
        hotkeyToOnboarding = false;
      });
    }
    onboardingWindow.show();
    app.focus({ steal: true });
  }

  ipcMain.on("onboarding:capture-hotkey", (_event, capturing) => {
    hotkeyToOnboarding = capturing === true;
  });
  ipcMain.handle("onboarding:finish", () => {
    log.info("onboarding_finished");
    onboardingWindow?.close();
    showHub({ route: "home" });
  });

  /** 菜单栏、双击图标要打开 SpeakMore 时：引导还没走完就回到引导，走完了是主窗口 */
  const showMain = () => (onboardingWindow ? showOnboarding() : showHub());

  const trayIcon = nativeImage.createFromPath(TRAY_ICON);
  const tray = new Tray(trayIcon);
  tray.setToolTip("SpeakMore");
  // 图标读不出来时菜单栏上会是空的一格，找不到入口。退回写两个字，并记下来
  if (trayIcon.isEmpty()) {
    log.error("tray_icon_missing", { path: TRAY_ICON });
    tray.setTitle("听写");
  }

  function refreshTrayMenu() {
    const summary = summarizeSetup(currentSetup());
    const headline = summary.ready
      ? `就绪 · 按 ${HOTKEY_KEYCAPS[hotkey]} 说话`
      : summary.missing.length > 0
        ? `还差：${summary.missing.join("、")}`
        : "准备中…";
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: headline, enabled: false },
        ...(summary.degraded ? [{ label: summary.degraded, enabled: false }] : []),
        { type: "separator" },
        // 下面几项照原版菜单栏的菜单（tray_menu__*）
        { label: "打开 SpeakMore", click: () => showHub({ route: "home" }) },
        { label: "历史记录", click: () => showHub({ route: "history" }) },
        { type: "separator" },
        { label: "设置…", accelerator: "CmdOrCtrl+,", click: () => showHub({ pane: "general" }) },
        { type: "separator" },
        { label: `版本 ${app.getVersion()}`, enabled: false },
        { label: "退出 SpeakMore", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
      ]),
    );
  }
  refreshTrayMenu();

  // 没有窗口时也继续待在菜单栏里
  app.on("window-all-closed", () => {});
  // 已经开着时又启动了一次。双击图标来的：把主窗口亮出来，让人知道它在哪。
  // speakmore 命令来的（两条命令同时启动，后到的那个）：那个人正看着终端，不弹窗口
  app.on("second-instance", (_event, _argv, _cwd, additionalData) => {
    if (!additionalData?.byCli) showMain();
  });
  app.on("before-quit", () => {
    rmSync(PATHS.pidFile, { force: true });
    // 先让小帮手的事件作废：它接下来的退出是我们自己关的，不该再报"按键监听停了"
    helperGeneration++;
    helper.stop();
    history.close();
    // 应用正在退出，这两样关不干净也不拦着；记一笔方便排查
    service?.close().catch((error) => log.warn("service_close_failed", { error: String(error) }));
    control?.close().catch((error) => log.warn("control_close_failed", { error: String(error) }));
  });

  // ---------- 命令行要主进程代办的事 ----------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** 等小帮手把两项权限报上来，或者确定它起不来；最多等 3 秒 */
  async function helperReported() {
    for (let waited = 0; helperState === "starting" && waited < 3_000; waited += 50) await sleep(50);
  }

  function describeStatus() {
    const setup = currentSetup();
    return {
      pid: process.pid,
      version: app.getVersion(),
      startedAt,
      // 启动时要等 key 验证完、麦克风的授权框有了回应，才算准备好
      starting: !startupChecked,
      hotkey,
      hotkeyLabel: hotkeyLabel(),
      // 连着单独启动的服务端时，用哪个模型由那边定
      provider: service ? keys.provider.id : null,
      // 每家的 key 在哪。装成应用的那个各存各的，命令行要靠这一项才知道
      keys: service ? keys.sources() : null,
      model: service ? formatModelChoice(service.model) : null,
      thinking: service ? thinkingFor(keys.provider) : null,
      theme: theme.id,
      // 装成应用的和命令启动的，权限和 key 各是一套：命令行据此决定该不该代它重启
      packaged: app.isPackaged,
      ...setup,
      summary: summarizeSetup(setup),
    };
  }

  // 端到端测试不开控制通道：它自己驱动整个流程，没有命令行参与
  control = e2e
    ? null
    : await startControlServer({
        socketPath: PATHS.controlSocket,
        log,
        handlers: {
          /** recheck：把会自己变的几样重新看一遍再回答（用户刚去系统设置里改过、网刚连上时用） */
          async status({ recheck = false }) {
            if (recheck) {
              const denied = Object.values(helperPermissions ?? {}).includes(false);
              if (denied || helperState === "stopped") recheckPermissions();
              reverifyKeyInBackground();
            }
            await helperReported();
            return describeStatus();
          },
          // provider 不给就是正在用的那一家（0.3 的命令行不给）
          "set-key": ({ key, provider }) => keys.save(key, { provider }),
          "forget-key": ({ provider } = {}) => keys.forget({ provider }),
          "check-model": ({ model }) => {
            let choice;
            try {
              choice = parseModelChoice(model);
            } catch (error) {
              return { ok: false, cause: "other", problem: `model ${error.message}` };
            }
            return keys.check(choice);
          },
          "reload-theme": reloadTheme,
          // 命令行的名字沿用窗口还分开时的叫法：show-settings 打开设置里还差东西的那一页
          "show-settings": () => showHub({ pane: "auto" }),
          "show-history": () => showHub({ route: "history" }),
          // 先把这次的回答发出去再退出
          quit: () => void setImmediate(() => app.quit()),
        },
      });

  // ---------- 启动时的检查 ----------

  const keyLoaded = keys.loadAtStartup();
  if (e2e) {
    const loaded = await keyLoaded;
    if (loaded.state !== "ready") throw new Error(`端到端测试需要能用的 key：${loaded.problem ?? loaded.state}`);
    await e2e.run({ bar, history, quit: (code) => app.exit(code) });
    return;
  }

  const granted = await systemPreferences.askForMediaAccess("microphone");
  log.info("microphone_access", { granted });
  await keyLoaded;
  startupChecked = true;
  setupChanged();
  offerSettingsIfIncomplete();
  // 已经开着时又去双击应用图标，系统不会再起一个，而是"重新打开"这一个：同样把主窗口亮出来。
  // 等启动检查做完才挂上，免得把启动本身也当成一次重新打开
  app.on("activate", showMain);
}
