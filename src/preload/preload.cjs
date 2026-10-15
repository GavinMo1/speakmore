// 页面能调用的全部主进程能力都列在这里。页面本身拿不到 Node 和 Electron 的接口。
// 沙箱里的预加载脚本只能用 CommonJS。
const { contextBridge, ipcRenderer, webFrame } = require("electron");

// 主题：页面的样式只用 var(--…) 引用颜色，值由主进程按现在的主题给（src/themes）。
// 同步取、马上注入，赶在页面画出第一帧之前。之后换主题时主进程会再发一份过来：先放上新的再撤掉旧的，
// 中间不会有哪一帧是没有颜色的。
let themeKey = webFrame.insertCSS(ipcRenderer.sendSync("theme:get"));
ipcRenderer.on("theme:changed", (_event, css) => {
  const previous = themeKey;
  themeKey = webFrame.insertCSS(css);
  webFrame.removeInsertedCSS(previous);
});

contextBridge.exposeInMainWorld("speakmore", {
  config: () => ipcRenderer.invoke("config:get"),

  // 悬浮条
  onInput: (callback) => ipcRenderer.on("input", (_event, payload) => callback(payload)),
  onNotice: (callback) => ipcRenderer.on("notice", (_event, message) => callback(message)),
  onBarControls: (callback) => ipcRenderer.on("bar:controls", (_event, enabled) => callback(enabled)),
  setBarVisible: (visible) => ipcRenderer.send("bar:set-visible", visible),
  captureBarInput: (regions) => ipcRenderer.send("bar:capture", regions),
  deliver: (payload) => ipcRenderer.invoke("dictation:deliver", payload),
  reportFailure: (payload) => ipcRenderer.invoke("dictation:failed", payload),

  onHotkeyChanged: (callback) => ipcRenderer.on("bar:hotkey", (_event, keycap) => callback(keycap)),

  // 主窗口：首页、历史记录
  appInfo: () => ipcRenderer.invoke("app:info"),
  listHistory: () => ipcRenderer.invoke("history:list"),
  usageReport: () => ipcRenderer.invoke("usage:report"),
  insights: () => ipcRenderer.invoke("insights:get"),
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  onHistoryChanged: (callback) => ipcRenderer.on("history:changed", () => callback()),
  onNavigate: (callback) => ipcRenderer.on("hub:navigate", (_event, target) => callback(target)),
  openHomepage: () => ipcRenderer.invoke("app:open-homepage"),

  // 主窗口：设置
  getSetup: () => ipcRenderer.invoke("setup:get"),
  onSetupChanged: (callback) => ipcRenderer.on("setup:changed", () => callback()),
  saveKey: (key) => ipcRenderer.invoke("setup:save-key", key),
  forgetKey: (provider) => ipcRenderer.invoke("setup:forget-key", provider),
  useProvider: (provider, key) => ipcRenderer.invoke("setup:use-provider", provider, key),
  readClipboard: () => ipcRenderer.invoke("setup:read-clipboard"),
  openKeyPage: (provider) => ipcRenderer.invoke("setup:open-key-page", provider),
  openPrivacySettings: (permission) => ipcRenderer.invoke("setup:open-privacy", permission),
  recheckPermissions: () => ipcRenderer.invoke("setup:recheck"),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("setup:set-open-at-login", enabled),
  setHotkey: (hotkey) => ipcRenderer.invoke("setup:set-hotkey", hotkey),

  // 首次引导
  captureHotkey: (capturing) => ipcRenderer.send("onboarding:capture-hotkey", capturing),
  onOnboardingHotkey: (callback) => ipcRenderer.on("onboarding:hotkey", (_event, key) => callback(key)),
  finishOnboarding: () => ipcRenderer.invoke("onboarding:finish"),
  setTheme: (theme) => ipcRenderer.invoke("setup:set-theme", theme),
});
