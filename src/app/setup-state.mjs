// 把"能不能用、还差什么"归成一个结论。菜单栏、设置窗口、按热键时的提示都用这一个，免得三处各说各的。

const OPEN_SETTINGS = "点菜单栏的“听写”打开设置";

/**
 * @param {object} setup
 * @param {{ state: "missing" | "unreadable" | "checking" | "rejected" | "ready", problem: string | null, cause?: string }} setup.key
 *   见 key-manager.mjs
 * @param {{ microphone: string, listen: boolean | null, trusted: boolean | null }} setup.permissions
 *   microphone 是系统给的状态（granted / denied / not-determined…）；listen、trusted 为 null 表示按键监听还没报上来
 * @param {"starting" | "running" | "stopped"} [setup.helper] 按键监听的小程序。stopped：退出了或者根本没起来
 * @param {string} [setup.providerName] 正在用哪一家的模型，缺 key 时点名
 * @returns {{ ready: boolean, missing: string[], blocker: string | null, degraded: string | null }}
 *   ready：现在按热键能不能听写；missing：确定缺的东西；blocker：按了热键却不能用时提示的那句话；
 *   degraded：能用但打了折扣时的说明
 */
export function summarizeSetup({ key, permissions, helper, providerName = "Gemini" }) {
  const missing = [];
  let blocker = null;

  if (key.state === "missing" || key.state === "unreadable") {
    missing.push(`${providerName} API key`);
    blocker = `还没有填 ${providerName} API key：${OPEN_SETTINGS}`;
  } else if (key.state === "rejected" && key.cause === "other") {
    // 那一家拒绝了请求，多半是模型名或思考档位写错：key 本身未必有问题，不能让人以为要换 key
    missing.push(`${providerName} 验证`);
    blocker = `${providerName} 验证没通过：${key.problem}`;
  } else if (key.state === "rejected") {
    missing.push(`${providerName} API key`);
    blocker = `API key 不能用：${key.problem}`;
  } else if (key.state === "checking") {
    blocker = "正在验证 API key，稍等一下";
  }

  if (permissions.microphone !== "granted") {
    missing.push("麦克风权限");
    blocker ??= `没有麦克风权限：${OPEN_SETTINGS}`;
  }
  // 没有输入监控权限时热键根本传不过来，所以它不会成为"按了热键之后"的那句提示
  if (permissions.listen === false) missing.push("输入监控权限");
  // 小程序不在了，两项权限就一直报不上来：不明说的话看起来永远是"正在准备"
  if (helper === "stopped") missing.push("按键监听");

  return {
    ready: blocker === null && permissions.listen === true,
    missing,
    blocker,
    degraded: permissions.trusted === false ? "没有辅助功能权限：文字会放进剪贴板，要自己按 ⌘V" : null,
  };
}
