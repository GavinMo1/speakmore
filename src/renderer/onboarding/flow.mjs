import { keyMissing, permissionGranted } from "../shared/setup-text.mjs";

// 首次引导走哪几步、每一步什么时候算做完。纯函数，不碰页面。
// 开屏 → 功能 → 快捷键 → 权限（只有 Mac）→ 引擎。引导里不选识别方式、不填密钥、不下模型，这些都在主窗口的引擎页做；
// 这里只演示三个功能、检查快捷键按不按得到、开权限，最后把人送到引擎页。

/** 三个功能，按这个顺序演示、检查 */
export const FEATURES = Object.freeze(["dictate", "translate", "lookup"]);

/** 要开的三项权限（Windows 上一项都不用开，没有这一步） */
export const PERMISSIONS = Object.freeze(["microphone", "listen", "trusted"]);

/** @param {string} platform process.platform */
export const stepsFor = (platform) =>
  platform === "win32"
    ? ["splash", "features", "keys", "engine"]
    : ["splash", "features", "keys", "permissions", "engine"];

/** 还没开的权限有几项；还在查的（小帮手没报上来）也算没开 */
export const permissionsOff = (setup) =>
  PERMISSIONS.filter((name) => permissionGranted(name, setup.permissions[name]) !== true).length;

/** 引擎配好了：密钥能用（或这种方式不要密钥），要的本机模型也下好了。在验证的算配好了 */
export const engineReady = (setup) => !keyMissing(setup) && !["missing", "failed"].includes(setup.localModel?.state);

/**
 * 这一步做完了没有：做完了"继续"是主按钮，没做完写"跳过"（照样能往下走）
 * @param {string} step
 * @param {{ passed: Set<string>, setup: object }} context passed：快捷键那一步按到了哪几个功能
 */
export function stepDone(step, { passed, setup }) {
  if (step === "keys") return FEATURES.every((id) => passed.has(id));
  if (step === "permissions") return permissionsOff(setup) === 0;
  return true;
}
