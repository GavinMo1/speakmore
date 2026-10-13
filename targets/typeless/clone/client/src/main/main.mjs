import { join } from "node:path";
import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, screen, systemPreferences, Tray } from "electron";
import { createDelivery } from "./delivery.mjs";
import { startHelper } from "./helper.mjs";
import { openHistory } from "./history.mjs";
import { log } from "./log.mjs";

// 主进程：两个窗口（悬浮条、历史）、菜单栏图标、原生小帮手，以及页面要它代办的几件事。
// 结构对应原版的"主进程 + 悬浮条 + 键盘子进程"（docs/03-process-architecture.md）。

const SERVER_URL = process.env.CLONE_SERVER_URL ?? "ws://127.0.0.1:8790/ws/rt_voice_flow";
// 热键是单独一个修饰键。原版用 fn；这里默认右 Option，这样能和原版同时开着用
const HOTKEY_LABELS = { right_option: "右 Option", right_command: "右 Command", right_control: "右 Control", fn: "fn" };
const HOTKEY = process.env.CLONE_HOTKEY ?? "right_option";
if (!Object.hasOwn(HOTKEY_LABELS, HOTKEY)) {
  console.error(`CLONE_HOTKEY 要是 ${Object.keys(HOTKEY_LABELS).join(" / ")} 之一，现在是 ${JSON.stringify(HOTKEY)}`);
  app.exit(2);
}
const HOTKEY_LABEL = HOTKEY_LABELS[HOTKEY];
const BAR_SIZE = { width: 380, height: 64 };
const BAR_BOTTOM_GAP = 28;

// 端到端测试用：数据写到临时目录，不碰真实的历史
if (process.env.CLONE_USER_DATA) app.setPath("userData", process.env.CLONE_USER_DATA);

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

  const history = openHistory(join(app.getPath("userData"), "history.db"));
  /** 小帮手报上来的两项权限；null 表示它还没启动好 */
  let permissions = null;
  let historyWindow = null;
  log.info("started", {
    hotkey: HOTKEY,
    user_data: app.getPath("userData"),
    server_url: SERVER_URL,
    e2e: Boolean(process.env.CLONE_E2E_OUT),
  });

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
  const notify = (message) => bar.webContents.send("notice", message);

  // ---------- 按键和贴字 ----------

  // 端到端测试时不启动小帮手：不听真键盘，也绝不往用户当前的窗口里贴字
  const e2e = process.env.CLONE_E2E_OUT ? await import("./e2e.mjs") : null;
  const helper = e2e
    ? e2e.fakeHelper
    : startHelper(join(app.getAppPath(), "build", "key-helper"), {
        args: ["--key", HOTKEY],
        onEvent: onHelperEvent,
        log,
      });

  function onHelperEvent(event) {
    switch (event.event) {
      case "ready":
        permissions = { listen: event.listen, trusted: event.trusted };
        log.info("helper_ready", permissions);
        refreshTrayMenu();
        if (!event.listen) notify(`没有输入监控权限，${HOTKEY_LABEL}不会生效：授权后重新启动`);
        else if (!event.trusted) notify("没有辅助功能权限：文字会放进剪贴板，要自己按 ⌘V");
        break;
      case "hotkey":
      case "other_key":
        // 热键不灵时先看这条日志有没有：没有就是小帮手没收到按键（权限或键选错了）
        log.info("key_event", { event: event.event, down: event.down });
        bar.webContents.send("hotkey", event);
        break;
      case "exit":
        permissions = null;
        log.error("helper_exited", { code: event.code, signal: event.signal });
        refreshTrayMenu();
        notify(`按键监听停了，${HOTKEY_LABEL}不会生效：重新启动试试`);
        break;
      default:
        log.warn("helper_unknown_event", { event: event.event });
    }
  }

  // ---------- 页面要主进程代办的事 ----------

  const delivery = createDelivery({
    recordingsDir: join(app.getPath("userData"), "Recordings"),
    history,
    paste: (text) => helper.paste(text),
    writeClipboard: (text) => clipboard.writeText(text),
    log,
  });
  const historyChanged = () => historyWindow?.webContents.send("history:changed");

  ipcMain.handle("config:get", () => ({ serverUrl: SERVER_URL, hotkeyLabel: HOTKEY_LABEL }));
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
  ipcMain.handle("clipboard:write", (_event, text) => {
    if (typeof text !== "string") throw new TypeError("要复制的不是文字");
    clipboard.writeText(text);
  });

  // ---------- 菜单栏和历史窗口 ----------

  function showHistory() {
    if (historyWindow) {
      historyWindow.focus();
      return;
    }
    historyWindow = new BrowserWindow({ width: 560, height: 680, minWidth: 380, title: "历史记录", webPreferences });
    historyWindow.loadFile(join(sourceDir, "renderer", "history.html"));
    historyWindow.on("closed", () => {
      historyWindow = null;
    });
  }

  // 菜单栏上只放文字，不放图标
  const tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("听写");

  function refreshTrayMenu() {
    const status = (label, ok) => ({
      label: `${label}：${permissions === null ? "未启动" : ok ? "正常" : "没有权限"}`,
      enabled: false,
    });
    tray.setContextMenu(
      Menu.buildFromTemplate([
        status(`热键（${HOTKEY_LABEL}）监听`, permissions?.listen),
        status("自动粘贴", permissions?.trusted),
        { type: "separator" },
        { label: "历史记录…", click: showHistory },
        { label: "退出", click: () => app.quit() },
      ]),
    );
  }
  refreshTrayMenu();

  // 没有窗口时也继续待在菜单栏里
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    helper.stop();
    history.close();
  });

  if (e2e) {
    await e2e.run({ bar, history, quit: (code) => app.exit(code) });
  } else {
    const granted = await systemPreferences.askForMediaAccess("microphone");
    log.info("microphone_access", { granted });
    if (!granted) notify("没有麦克风权限：到 系统设置 › 隐私与安全性 › 麦克风 里打开");
  }
}
