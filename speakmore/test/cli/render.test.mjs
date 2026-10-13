import assert from "node:assert/strict";
import { test } from "node:test";
import { renderConfig, renderHistory, renderStatus } from "../../src/cli/render.mjs";

const timeZone = "Asia/Shanghai";
// 上海时间 2026-10-13 15:00
const now = new Date("2026-10-13T07:00:00.000Z");
const plain = { color: false, timeZone, now };

const ready = {
  pid: 4321,
  version: "0.1.0",
  starting: false,
  hotkey: "right_option",
  hotkeyLabel: "右 Option 键",
  model: "gemini-3.5-flash",
  thinking: "MINIMAL",
  packaged: false,
  helper: "running",
  key: { state: "ready", source: "stored", problem: null, verified: true },
  permissions: { microphone: "granted", listen: true, trusted: true },
  summary: { ready: true, missing: [], blocker: null, degraded: null },
};
const settings = {
  hotkey: { value: "right_option", source: "default" },
  model: { value: "gemini-3.5-flash", source: "default" },
  thinking: { value: "MINIMAL", source: "default" },
};
const noStats = { today: null, total: null };

test("没有在运行时只说一句怎么启动", () => {
  const text = renderStatus({ status: null, version: "0.1.0", settings, stats: noStats }, plain);
  assert.match(text, /SpeakMore 0\.1\.0 · 没有运行/);
  assert.match(text, /speakmore/);
  assert.doesNotMatch(text, /权限/);
});

test("一切就绪时说怎么用，并列出 key、权限、热键、模型", () => {
  const text = renderStatus({ status: ready, version: "0.1.0", settings, stats: noStats }, plain);
  assert.match(text, /SpeakMore 0\.1\.0 · 运行中/);
  assert.match(text, /按一下右 Option 键开始说话/);
  assert.match(text, /key\s+已保存，验证通过/);
  assert.match(text, /麦克风 ✓\s+输入监控 ✓\s+辅助功能 ✓/);
  assert.match(text, /热键\s+右 Option 键/);
  assert.match(text, /模型\s+gemini-3\.5-flash（MINIMAL）/);
});

test("缺东西时标题说还差几样，逐项标出，并说权限记在终端名下", () => {
  const status = {
    ...ready,
    key: { state: "missing", source: null, problem: null },
    permissions: { microphone: "denied", listen: false, trusted: false },
    summary: {
      ready: false,
      missing: ["Gemini API key", "麦克风权限", "输入监控权限"],
      blocker: "还没有填 Gemini API key",
      degraded: "没有辅助功能权限：文字会放进剪贴板，要自己按 ⌘V",
    },
  };
  const text = renderStatus({ status, version: "0.1.0", settings, stats: noStats }, plain);
  assert.match(text, /运行中，还差 3 样/);
  assert.match(text, /key\s+还没有填：运行 speakmore key/);
  assert.match(text, /麦克风 ✗\s+输入监控 ✗\s+辅助功能 ✗/);
  assert.match(text, /没有辅助功能权限：文字会放进剪贴板/);
  assert.match(text, /speakmore settings/);
  assert.match(text, /终端/);
});

test("key 的各种状态各有一句话", () => {
  const withKey = (key) =>
    renderStatus({ status: { ...ready, key }, version: "0.1.0", settings, stats: noStats }, plain);
  assert.match(withKey({ state: "ready", source: "env", problem: null, verified: true }), /环境变量 GEMINI_API_KEY/);
  assert.match(withKey({ state: "checking", source: "stored", problem: null }), /正在验证/);
  assert.match(withKey({ state: "unreadable", source: "stored", problem: "读不出来了" }), /读不出来了/);
  // 启动时没连上网：先用着，如实说还没验证
  assert.match(withKey({ state: "ready", source: "stored", problem: null, verified: false }), /已保存.*还没验证/);
});

test("key 不能用时，按原因说该怎么办：换 key、改环境变量、还是去看模型设置", () => {
  const rejected = (key) =>
    renderStatus(
      { status: { ...ready, key: { state: "rejected", ...key } }, version: "0.1.0", settings, stats: noStats },
      plain,
    );
  const revoked = rejected({ source: "stored", cause: "key", problem: "这把 key 无效" });
  assert.match(revoked, /不能用：这把 key 无效。运行 speakmore key 换一把/);

  // 环境变量里的那把不对：存一把新的没用，下次启动用的还是环境变量
  const badEnv = rejected({ source: "env", cause: "key", problem: "这把 key 无效" });
  assert.match(badEnv, /环境变量 GEMINI_API_KEY 里的 key 不能用：这把 key 无效/);
  assert.doesNotMatch(badEnv, /换一把/);

  // Gemini 拒绝了请求：多半是模型名或档位，不该让人去换 key
  const wrongModel = rejected({
    source: "stored",
    cause: "other",
    problem: "Gemini 拒绝了请求：models/x is not found",
  });
  assert.match(wrongModel, /验证没通过：Gemini 拒绝了请求：models\/x is not found/);
  assert.match(wrongModel, /speakmore config/);
  assert.doesNotMatch(wrongModel, /换一把/);
});

test("模型和热键写的是后台应用正在用的；设置改过还没生效时提醒重启", () => {
  // 后台应用是带着别的设置启动的（比如启动它的那条命令上有环境变量），和现在的设置不一样
  const status = { ...ready, model: "gemini-3.8-flash", thinking: "LOW" };
  const stale = renderStatus({ status, version: "0.1.0", settings, stats: noStats }, plain);
  assert.match(stale, /模型\s+gemini-3\.8-flash（LOW）/);
  assert.match(stale, /model、thinking.*speakmore restart/);

  const same = renderStatus({ status: ready, version: "0.1.0", settings, stats: noStats }, plain);
  assert.doesNotMatch(same, /speakmore restart/);

  const external = {
    ...ready,
    model: null,
    thinking: null,
    key: { state: "ready", source: "external", problem: null },
  };
  assert.match(
    renderStatus({ status: external, version: "0.1.0", settings, stats: noStats }, plain),
    /模型\s+由单独启动的服务端决定/,
  );
});

test("按键监听的小程序停了：明说热键不会生效，以及怎么办", () => {
  const status = {
    ...ready,
    helper: "stopped",
    permissions: { microphone: "granted", listen: null, trusted: null },
    summary: { ready: false, missing: ["按键监听"], blocker: null, degraded: null },
  };
  const text = renderStatus({ status, version: "0.1.0", settings, stats: noStats }, plain);
  assert.match(text, /还差 1 样/);
  assert.match(text, /热键不会生效/);
  assert.match(text, /speakmore restart/);
});

test("装成应用运行时，权限记在 SpeakMore 自己名下，不说成终端", () => {
  const status = {
    ...ready,
    packaged: true,
    permissions: { microphone: "granted", listen: false, trusted: true },
    summary: { ready: false, missing: ["输入监控权限"], blocker: null, degraded: null },
  };
  const text = renderStatus({ status, version: "0.1.0", settings, stats: noStats }, plain);
  assert.match(text, /在系统设置的列表里找“SpeakMore”/);
  assert.doesNotMatch(text, /终端/);
});

test("还在启动时如实说，不提前报就绪", () => {
  const status = { ...ready, starting: true, summary: { ...ready.summary, ready: false } };
  const text = renderStatus({ status, version: "0.1.0", settings, stats: noStats }, plain);
  assert.match(text, /正在启动/);
  assert.doesNotMatch(text, /开始说话/);
});

test("有历史时给出今天和累计的数：次数、字数、时长、每分钟多少字", () => {
  const stats = {
    today: { dictations: 3, characters: 420, seconds: 95, failed: 0 },
    total: { dictations: 132, characters: 12480, seconds: 2880, failed: 2 },
  };
  const text = renderStatus({ status: ready, version: "0.1.0", settings, stats }, plain);
  assert.match(text, /今天\s+3 次 · 420 字 · 1 分 35 秒/);
  assert.match(text, /累计\s+132 次 · 12,480 字 · 48 分钟 · 每分钟 260 字/);
});

test("一次都没说过时不列统计", () => {
  const stats = {
    today: { dictations: 0, characters: 0, seconds: 0, failed: 0 },
    total: { dictations: 0, characters: 0, seconds: 0, failed: 0 },
  };
  const text = renderStatus({ status: ready, version: "0.1.0", settings, stats }, plain);
  assert.doesNotMatch(text, /累计/);
});

const row = (overrides) => ({
  id: "a",
  status: "completed",
  refinedText: "一句话",
  error: null,
  duration: 3,
  audioLocalPath: "/data/Recordings/a.webm",
  createdAt: "2026-10-13T06:32:00.000Z",
  ...overrides,
});

test("历史按天分组，新的在前，今天和昨天有名字，每条是时间加文字", () => {
  const rows = [
    row({ id: "c", createdAt: "2026-10-13T06:32:00.000Z", refinedText: "今天下午说的" }),
    row({ id: "b", createdAt: "2026-10-12T01:05:00.000Z", refinedText: "昨天早上说的" }),
    row({ id: "a", createdAt: "2026-10-08T12:00:00.000Z", refinedText: "上周说的" }),
  ];
  const text = renderHistory({ rows, total: 3 }, plain);
  assert.deepEqual(
    text.split("\n").filter((line) => line.trim() !== ""),
    [
      "今天 · 10 月 13 日",
      "  14:32  今天下午说的",
      "昨天 · 10 月 12 日",
      "  09:05  昨天早上说的",
      "10 月 8 日 周四",
      "  20:00  上周说的",
    ],
  );
});

test("按本地日期分组：UTC 还在前一天、本地已经过了零点的，算本地那一天", () => {
  const rows = [row({ createdAt: "2026-10-12T16:30:00.000Z" })];
  assert.match(renderHistory({ rows, total: 1 }, plain), /今天 · 10 月 13 日\n {2}00:30/);
});

test("多段的文字后面几行缩进对齐，段落之间的空行留着", () => {
  const rows = [row({ refinedText: "第一段\n\n第二段\n1. 一\n2. 二" })];
  const lines = renderHistory({ rows, total: 1 }, plain).split("\n");
  assert.deepEqual(lines.slice(1, 6), ["  14:32  第一段", "", "         第二段", "         1. 一", "         2. 二"]);
});

test("失败的那条说明原因，并指出录音还留着", () => {
  const rows = [row({ status: "failed", refinedText: "", error: "连不上 Gemini", duration: 7.2 })];
  const text = renderHistory({ rows, total: 1 }, plain);
  assert.match(text, /14:32 {2}✗ 没有成功：连不上 Gemini/);
  assert.match(text, /录音 7\.2 秒，留在 \/data\/Recordings\/a\.webm/);
});

test("没显示完时在最后说共有多少条、怎么看更多", () => {
  const text = renderHistory({ rows: [row()], total: 57 }, plain);
  assert.match(text, /显示最近 1 条，共 57 条/);
  assert.match(text, /speakmore history -n 57/);
  assert.doesNotMatch(renderHistory({ rows: [row()], total: 1 }, plain), /共 1 条/);
});

test("一条都没有时说一句怎么开始", () => {
  assert.match(renderHistory({ rows: [], total: 0 }, plain), /还没有听写记录/);
});

test("设置逐项列出现在的值、从哪来、能填什么，后面是文件在哪", () => {
  const text = renderConfig(
    {
      settings: {
        ...settings,
        hotkey: { value: "fn", source: "file" },
        model: { value: "gemini-3.8-flash", source: "env" },
      },
      paths: { dataDir: "/data", settingsFile: "/data/settings.json", logFile: "/data/logs/main.log" },
    },
    plain,
  );
  assert.match(text, /hotkey\s+fn\s+地球仪（fn）键/);
  assert.match(text, /right_option \/ right_command \/ right_control \/ fn/);
  assert.match(text, /model\s+gemini-3\.8-flash\s+.*环境变量 GEMINI_MODEL/);
  assert.match(text, /thinking\s+MINIMAL\s+.*默认/);
  assert.match(text, /speakmore config set hotkey fn/);
  assert.match(text, /\/data\/logs\/main\.log/);
});

test("开了颜色时对勾和叉带颜色，关了就是纯文字", () => {
  const view = { status: ready, version: "0.1.0", settings, stats: noStats };
  assert.ok(renderStatus(view, { ...plain, color: true }).includes("\x1b[32m✓\x1b[0m"));
  assert.ok(!renderStatus(view, plain).includes("\x1b["));
});
