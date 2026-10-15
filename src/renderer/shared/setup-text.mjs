// 主窗口的设置和首次引导都要说的几句话：权限是什么状态、还差不差 key、主进程报的错怎么给人看。
// 纯函数，不碰页面。

/** 主进程抛的错经过 IPC 会带上一截"Error invoking remote method 'xx': Error: "，给人看时去掉 */
export const describeError = (error) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']*': (?:\w*Error: )?/,
    "",
  );

/** key 还不能用（没有、读不出来、被拒了）。正在验证的不算 */
export const keyMissing = ({ key }) => key.state !== "ready" && key.state !== "checking";

/** 三项权限里有没给的（还没报上来的不算） */
export const permissionDenied = ({ permissions }) =>
  permissions.microphone !== "granted" || permissions.listen === false || permissions.trusted === false;

/** 这一项权限给了没有：true 给了、false 没给、null 还在查 */
export function permissionGranted(name, value) {
  if (name === "microphone") return value === "granted";
  return value;
}

/**
 * 一项权限的状态写成什么、什么语气、按钮上写什么。
 * @returns {[label: string, tone: "ok" | "problem" | "pending", action: string]}
 */
export function permissionText(name, value) {
  if (name === "microphone") {
    if (value === "granted") return ["已授权", "ok", "打开系统设置"];
    // 从没问过时系统设置的列表里还没有这个应用，要先让系统弹一次授权框
    if (value === "not-determined") return ["还没授权", "problem", "授权"];
    return ["没有授权", "problem", "打开系统设置"];
  }
  if (value === null) return ["检查中…", "pending", "打开系统设置"];
  return value ? ["已授权", "ok", "打开系统设置"] : ["没有授权", "problem", "打开系统设置"];
}
