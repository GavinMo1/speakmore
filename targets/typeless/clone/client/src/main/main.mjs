import { join } from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { createDelivery } from "./delivery.mjs";
import { startHelper } from "./helper.mjs";
import { openHistory } from "./history.mjs";
import { createKeyStore } from "./key-store.mjs";
import { log } from "./log.mjs";
import { describeKeyError, startService } from "./service.mjs";
import { summarizeSetup } from "./setup-state.mjs";

// 主进程：三个窗口（悬浮条、历史、设置）、菜单栏图标、原生小帮手、内置的听写服务，以及页面要它代办的几件事。
// 结构对应原版的"主进程 + 悬浮条 + 键盘子进程"（docs/03-process-architecture.md）。

/** 调试用：设了就连这个地址上单独启动的服务端，不启动内置的那个 */
const EXTERNAL_SERVER_URL = process.env.CLONE_SERVER_URL ?? null;
// 热键是单独一个修饰键。原版用 fn；这里默认右 Option，这样能和原版同时开着用
// 名字要能直接嵌进中文句子里（"按一下右 Option 键开始说话"），所以都以汉字开头、以"键"结尾
const HOTKEY_LABELS = {
  right_option: "右 Option 键",
  right_command: "右 Command 键",
  right_control: "右 Control 键",
  fn: "地球仪（fn）键",
};
const HOTKEY = process.env.CLONE_HOTKEY ?? "right_option";
if (!Object.hasOwn(HOTKEY_LABELS, HOTKEY)) {
  console.error(`CLONE_HOTKEY 要是 ${Object.keys(HOTKEY_LABELS).join(" / ")} 之一，现在是 ${JSON.stringify(HOTKEY)}`);
  app.exit(2);
}
const HOTKEY_LABEL = HOTKEY_LABELS[HOTKEY];
const BAR_SIZE = { width: 380, height: 64 };
const BAR_BOTTOM_GAP = 28;
const KEY_PAGE_URL = "https://aistudio.google.com/apikey";
/** 系统设置里三项权限各自的页面 */
const PRIVACY_PANES = {
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  listen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
  trusted: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
};

// 数据目录写死成这个名字：从终端启动和装成应用之后的应用名不一样，不写死的话历史会分成两份。
// 端到端测试时换到临时目录，不碰真实的历史
app.setPath("userData", process.env.CLONE_USER_DATA ?? join(app.getPath("appData"), "typeless-clone-client"));

if (!app.requestSingleInstanceLock()) {
  console.error("已经有一个在运行了");
  app.exit(1);
}

const sourceDir = join(app.getAppPath(), "src");
const webPreferences = { preload: join(sourceDir, "preload", "preload.cjs"), sandbox: true, contextIsolation: true };

// 不能写成顶层的 await app.whenReady()：Electron 要等主模块加载完才会就绪，
// 而顶层 await 让模块一直加载不完，两边互相等（Electron 44.7 实测如此）。
app
  .whenReady()
  .then(main)
  .catch((error) => {
    // 启动失败时没有窗口可以报错，记下来并以非零码退出，不留一个什么都不干的进程
    log.error("startup_failed", { error: String(error?.stack ?? error) });
    app.exit(1);
  });

async function main() {
  app.dock?.hide();

  const userData = app.getPath("userData");
  const history = openHistory(join(userData, "history.db"));
  const keyStore = createKeyStore({ file: join(userData, "gemini-key.bin"), safeStorage });
  const service = EXTERNAL_SERVER_URL ? null : await startService({ log });
  const serverUrl = EXTERNAL_SERVER_URL ?? service.url;
  const e2e = process.env.CLONE_E2E_OUT ? await import("./e2e.mjs") : null;

  /** key 的状态：missing / unreadable / checking / rejected / ready；source 是 env、stored 或 external */
  let key = { state: "missing", source: null, problem: null };
  /** 小帮手报上来的两项权限；null 表示它还没启动好 */
  let helperPermissions = null;
  /** 启动时对麦克风和 key 的检查做完了没有 */
  let startupChecked = false;
  let historyWindow = null;
  let settingsWindow = null;
  log.info("started", {
    hotkey: HOTKEY,
    user_data: userData,
    server_url: serverUrl,
    packaged: app.isPackaged,
    e2e: Boolean(e2e),
  });

  // ---------- 能不能用、还差什么 ----------

  const currentSetup = () => ({
    key,
    permissions: {
      microphone: systemPreferences.getMediaAccessStatus("microphone"),
      listen: helperPermissions?.listen ?? null,
      trusted: helperPermissions?.trusted ?? null,
    },
  });

  let offeredSettings = false;
  /**
   * 还缺东西就把设置窗口打开，第一次启动的人不用猜下一步该干什么。只主动弹一次。
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
    showSettings();
  }

  /** 上面任何一样变了都调一次：菜单栏和设置窗口跟着更新 */
  function setupChanged() {
    refreshTrayMenu();
    settingsWindow?.webContents.send("setup:changed");
  }

  /** 拿一把 key 去验证，通过了才开始用。不抛错：结果记在 key 的状态里 */
  async function adoptKey(apiKey, source) {
    key = { state: "checking", source, problem: null };
    setupChanged();
    try {
      await service.useKey(apiKey);
      key = { state: "ready", source, problem: null };
      log.info("key_ready", { source });
    } catch (error) {
      key = { state: "rejected", source, problem: describeKeyError(error) };
      log.error("key_rejected", { source, error: String(error?.message ?? error).slice(0, 300) });
    }
    setupChanged();
    return key;
  }

  /** 启动时找 key：环境变量优先（从终端用按需加载器启动时），其次是存在钥匙串里的那把 */
  function loadKeyAtStartup() {
    if (!service) {
      key = { state: "ready", source: "external", problem: null };
      return Promise.resolve(key);
    }
    const fromEnv = process.env.GEMINI_API_KEY?.trim();
    if (fromEnv) return adoptKey(fromEnv, "env");
    let stored;
    try {
      stored = keyStore.load();
    } catch (error) {
      // 换了签名或钥匙串里的密钥没了都会这样，只能请用户重新填
      log.error("key_unreadable", { error: String(error?.message ?? error) });
      key = { state: "unreadable", source: "stored", problem: "存着的 key 读不出来了，重新填一次" };
      return Promise.resolve(key);
    }
    return stored ? adoptKey(stored, "stored") : Promise.resolve(key);
  }

  // ---------- 悬浮条 ----------

  function createBar() {
    const { workArea } = screen.getPrimaryDisplay();
    const bar = new BrowserWindow({
      ...BAR_SIZE,
      x: Math.round(workArea.x + (workArea.width - BAR_SIZE.width) / 2),
      y: workArea.y + workArea.height - BAR_SIZE.height - BAR_BOTTOM_GAP,
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
    bar.setIgnoreMouseEvents(true);
    bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    bar.loadFile(join(sourceDir, "renderer", "bar.html"));
    return bar;
  }

  const bar = createBar();
  ipcMain.on("bar:set-visible", (_event, visible) => {
    if (visible) bar.showInactive();
    else bar.hide();
  });
  const notify = (message) => {
    // 退出途中窗口已经销毁，这时再发消息会抛错
    if (!bar.isDestroyed()) bar.webContents.send("notice", message);
  };

  // ---------- 按键和贴字 ----------

  let helper = null;
  /** 每启动一个小帮手加一；旧的那个退出时发来的事件靠它认出来并丢掉 */
  let helperGeneration = 0;

  function launchHelper() {
    const generation = ++helperGeneration;
    helperPermissions = null;
    helper = startHelper(join(app.getAppPath(), "build", "key-helper"), {
      args: ["--key", HOTKEY],
      onEvent: (event) => {
        if (generation === helperGeneration) onHelperEvent(event);
      },
      log,
    });
  }

  function onHelperEvent(event) {
    switch (event.event) {
      case "ready":
        helperPermissions = { listen: event.listen, trusted: event.trusted };
        log.info("helper_ready", helperPermissions);
        setupChanged();
        offerSettingsIfIncomplete();
        break;
      case "hotkey":
      case "other_key": {
        // 热键不灵时先看这条日志有没有：没有就是小帮手没收到按键（权限或键选错了）
        log.info("key_event", { event: event.event, down: event.down });
        const { blocker } = summarizeSetup(currentSetup());
        if (blocker === null) bar.webContents.send("hotkey", event);
        else if (event.event === "hotkey" && event.down) notify(blocker);
        break;
      }
      case "exit":
        helperPermissions = null;
        log.error("helper_exited", { code: event.code, signal: event.signal });
        setupChanged();
        notify(`按键监听停了，${HOTKEY_LABEL}不会生效：重新启动试试`);
        break;
      default:
        log.warn("helper_unknown_event", { event: event.event });
    }
  }

  // 端到端测试时不启动小帮手：不听真键盘，也绝不往用户当前的窗口里贴字
  if (e2e) helper = e2e.fakeHelper;
  else launchHelper();

  // ---------- 页面要主进程代办的事 ----------

  const delivery = createDelivery({
    recordingsDir: join(userData, "Recordings"),
    history,
    paste: (text) => helper.paste(text),
    writeClipboard: (text) => clipboard.writeText(text),
    log,
  });
  const historyChanged = () => historyWindow?.webContents.send("history:changed");

  ipcMain.handle("config:get", () => ({ serverUrl, hotkeyLabel: HOTKEY_LABEL }));
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
  ipcMain.handle("history:show", () => showHistory());
  ipcMain.handle("clipboard:write", (_event, text) => {
    if (typeof text !== "string") throw new TypeError("要复制的不是文字");
    clipboard.writeText(text);
  });

  // ---------- 设置窗口要主进程代办的事 ----------

  ipcMain.handle("setup:get", () => {
    const setup = currentSetup();
    return {
      ...setup,
      summary: summarizeSetup(setup),
      hotkeyLabel: HOTKEY_LABEL,
      // 开机启动登记的是"这个应用"；从终端启动时登记上去的会是 Electron 本身，所以只在装成应用后开放
      openAtLogin: { supported: app.isPackaged, enabled: app.getLoginItemSettings().openAtLogin },
      dataDir: userData,
    };
  });
  ipcMain.handle("setup:save-key", async (_event, value) => {
    if (typeof value !== "string" || value.trim() === "") return { ok: false, problem: "还没有填 key" };
    if (!service) return { ok: false, problem: "现在连的是单独启动的服务端（CLONE_SERVER_URL），key 在那边配" };
    const apiKey = value.trim();
    const previous = key;
    const result = await adoptKey(apiKey, "stored");
    if (result.state !== "ready") {
      // 服务里原来能用的那把还在用（useKey 失败不会换掉它），状态也要跟着还原
      if (previous.state === "ready") {
        key = previous;
        setupChanged();
      }
      return { ok: false, problem: result.problem };
    }
    try {
      keyStore.save(apiKey);
    } catch (error) {
      // 验证过了但存不下来：这次运行照样能用，下次启动要重填，如实告诉用户
      log.error("key_save_failed", { error: String(error?.message ?? error) });
      return { ok: false, problem: `key 能用，但没存下来（${error.message}），退出后要重新填` };
    }
    return { ok: true };
  });
  ipcMain.handle("setup:forget-key", () => {
    keyStore.clear();
    service?.forgetKey();
    key = { state: "missing", source: null, problem: null };
    log.info("key_forgotten");
    setupChanged();
  });
  ipcMain.handle("setup:read-clipboard", () => clipboard.readText());
  ipcMain.handle("setup:open-key-page", () => shell.openExternal(KEY_PAGE_URL));
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
  ipcMain.handle("setup:recheck", () => {
    // 两项系统权限是小帮手启动时查的，授权之后要重启它才看得到
    if (!e2e) {
      helper.stop();
      launchHelper();
    }
    setupChanged();
  });
  ipcMain.handle("setup:set-open-at-login", (_event, enabled) => {
    if (!app.isPackaged) throw new Error("从终端启动时不能设置开机启动");
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    log.info("open_at_login", { enabled: Boolean(enabled) });
    setupChanged();
  });

  // ---------- 菜单栏和两个普通窗口 ----------

  function showWindow(existing, create) {
    const window = existing ?? create();
    window.show();
    // 这是个没有程序坞图标的应用，不主动要一下焦点的话窗口会开在别的应用后面
    app.focus({ steal: true });
    return window;
  }

  function showHistory() {
    historyWindow = showWindow(historyWindow, () => {
      const window = new BrowserWindow({ width: 560, height: 680, minWidth: 380, title: "历史记录", webPreferences });
      window.loadFile(join(sourceDir, "renderer", "history.html"));
      window.on("closed", () => {
        historyWindow = null;
      });
      return window;
    });
  }

  function showSettings() {
    settingsWindow = showWindow(settingsWindow, () => {
      const window = new BrowserWindow({
        width: 560,
        height: 720,
        minWidth: 460,
        minHeight: 480,
        title: "听写设置",
        webPreferences,
      });
      window.loadFile(join(sourceDir, "renderer", "settings.html"));
      // 用户去系统设置里改完权限再切回来时，状态跟着刷新
      window.on("focus", () => window.webContents.send("setup:changed"));
      window.on("closed", () => {
        settingsWindow = null;
      });
      return window;
    });
  }

  // 菜单栏上只放文字，不放图标
  const tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("听写");

  function refreshTrayMenu() {
    const summary = summarizeSetup(currentSetup());
    const headline = summary.ready
      ? `可以用了：按一下${HOTKEY_LABEL}开始说话`
      : summary.missing.length > 0
        ? `还差：${summary.missing.join("、")}`
        : "正在准备…";
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: headline, enabled: false },
        ...(summary.degraded ? [{ label: summary.degraded, enabled: false }] : []),
        { type: "separator" },
        { label: "设置…", click: showSettings },
        { label: "历史记录…", click: showHistory },
        { type: "separator" },
        { label: "退出", click: () => app.quit() },
      ]),
    );
  }
  refreshTrayMenu();

  // 没有窗口时也继续待在菜单栏里
  app.on("window-all-closed", () => {});
  // 已经开着时又启动了一次（比如又双击了一下图标）：把设置窗口亮出来，让人知道它在哪
  app.on("second-instance", showSettings);
  app.on("before-quit", () => {
    // 先让小帮手的事件作废：它接下来的退出是我们自己关的，不该再报"按键监听停了"
    helperGeneration++;
    helper.stop();
    history.close();
    // 应用正在退出，服务关不干净也不拦着；记一笔方便排查
    service?.close().catch((error) => log.warn("service_close_failed", { error: String(error) }));
  });

  // ---------- 启动时的检查 ----------

  const keyLoaded = loadKeyAtStartup();
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
}
