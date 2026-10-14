// 几个画面的测试共用的：固定的时区和"现在"、一个就绪的状态、默认设置。

export const timeZone = "Asia/Shanghai";
// 上海时间 2026-10-13 15:00
export const now = new Date("2026-10-13T07:00:00.000Z");
export const plain = { color: false, timeZone, now };

export const ready = {
  pid: 4321,
  version: "0.1.0",
  starting: false,
  hotkey: "right_option",
  hotkeyLabel: "右 Option 键",
  provider: "gemini",
  model: "gemini/gemini-3.6-flash",
  thinking: "MINIMAL",
  packaged: false,
  helper: "running",
  key: { state: "ready", source: "stored", problem: null, verified: true },
  permissions: { microphone: "granted", listen: true, trusted: true },
  summary: { ready: true, missing: [], blocker: null, degraded: null },
};
export const settings = {
  hotkey: { value: "right_option", source: "default" },
  model: { value: "gemini/gemini-3.6-flash", source: "default" },
  thinking: { value: "MINIMAL", source: "default" },
  theme: { value: "ink", source: "default" },
};
export const noStats = { today: null, total: null };
