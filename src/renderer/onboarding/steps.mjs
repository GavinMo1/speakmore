import { permissionGranted } from "../shared/setup-text.mjs";
import { needsOf, planOf } from "./plan.mjs";

// 首次引导有哪几步、从哪一步开始、每一步算不算做完了。纯函数，不碰页面。
// 原版分"注册 · 设置 · 体验一下"三段（onboarding__steps__*）；我们没有账号，第一段换成选用法、接上模型。
// 哪一步都能往回退、往前跳：没做完的也能跳过，进去再配（数据隐私不要 key，什么都不配也能先进去看看）。

export const STEPS = ["way", "prepare", "permissions", "microphone", "hotkey", "try", "done"];

/** 每一步属于顶上三段里的哪一段 */
const GROUP_OF = {
  way: "model",
  prepare: "model",
  permissions: "setup",
  microphone: "setup",
  hotkey: "setup",
  try: "try",
  done: "try",
};
export const GROUPS = ["model", "setup", "try"];

/** 点顶上某一段时去它的第一步 */
export const firstStepOf = (group) => STEPS.find((step) => GROUP_OF[step] === group);

/**
 * 打开引导时从哪一步开始：现在用的那一套什么都不差就从设置开始（模型那几步退回去还能改）；
 * 连着单独启动的服务端时用哪种方式由那边定，也从设置开始
 */
export function startStep(setup) {
  if (!setup.switchable) return "permissions";
  return needsOf(planOf(setup), setup).length === 0 ? "permissions" : "way";
}

/**
 * 这一步做完了没有：做完了底下的按钮写"继续"，没做完写"跳过"（照样能往下走）。
 * 测麦克风、测快捷键靠那一步自己的"是的，继续"，底下那颗总是"跳过"
 * @param {{ setup: object, said: boolean }} state said：体验一下那一步已经说出了字
 */
export function stepDone(step, { setup, said }) {
  switch (step) {
    case "way":
      return true;
    case "prepare":
      return needsOf(planOf(setup), setup).length === 0;
    case "permissions":
      // 辅助功能没有也能用（文字放进剪贴板），不算没做完
      return (
        permissionGranted("microphone", setup.permissions.microphone) &&
        permissionGranted("listen", setup.permissions.listen) === true
      );
    case "try":
      return said;
    default:
      return false;
  }
}

/** 顶上三段各是什么状态：done 做完了、current 正在做、todo 还没到 */
export function groupStates(step) {
  const current = GROUPS.indexOf(GROUP_OF[step]);
  return Object.fromEntries(
    GROUPS.map((group, index) => [group, index < current ? "done" : index === current ? "current" : "todo"]),
  );
}
