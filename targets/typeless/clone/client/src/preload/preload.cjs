// 页面能调用的全部主进程能力都列在这里。页面本身拿不到 Node 和 Electron 的接口。
// 沙箱里的预加载脚本只能用 CommonJS。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clone", {
  config: () => ipcRenderer.invoke("config:get"),

  // 悬浮条
  onHotkey: (callback) => ipcRenderer.on("hotkey", (_event, payload) => callback(payload)),
  onNotice: (callback) => ipcRenderer.on("notice", (_event, message) => callback(message)),
  setBarVisible: (visible) => ipcRenderer.send("bar:set-visible", visible),
  deliver: (payload) => ipcRenderer.invoke("dictation:deliver", payload),
  reportFailure: (payload) => ipcRenderer.invoke("dictation:failed", payload),

  // 历史窗口
  listHistory: () => ipcRenderer.invoke("history:list"),
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  onHistoryChanged: (callback) => ipcRenderer.on("history:changed", () => callback()),

  // 设置窗口
  getSetup: () => ipcRenderer.invoke("setup:get"),
  onSetupChanged: (callback) => ipcRenderer.on("setup:changed", () => callback()),
  saveKey: (key) => ipcRenderer.invoke("setup:save-key", key),
  forgetKey: () => ipcRenderer.invoke("setup:forget-key"),
  readClipboard: () => ipcRenderer.invoke("setup:read-clipboard"),
  openKeyPage: () => ipcRenderer.invoke("setup:open-key-page"),
  openPrivacySettings: (permission) => ipcRenderer.invoke("setup:open-privacy", permission),
  recheckPermissions: () => ipcRenderer.invoke("setup:recheck"),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("setup:set-open-at-login", enabled),
  showHistory: () => ipcRenderer.invoke("history:show"),
});
