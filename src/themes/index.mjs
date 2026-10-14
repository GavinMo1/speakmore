// 登记在册的主题。界面和命令行都从这里拿，不直接引用某一套。

import cinnabar from "./cinnabar.mjs";
import indigo from "./indigo.mjs";
import ink from "./ink.mjs";

/** 按这个顺序列给用户看。加一套：照着 ink.mjs 写一个文件，在这里加一行 */
export const THEMES = [ink, cinnabar, indigo];

/** 没选过时用哪一套 */
export const DEFAULT_THEME = ink.id;

/**
 * 按 id 或者名字找（"cinnabar" 和 "朱砂" 都行）。
 * @returns {(typeof THEMES)[number] | null} 没有这一套时是 null
 */
export function findTheme(idOrName) {
  return THEMES.find((theme) => theme.id === idOrName || theme.name === idOrName) ?? null;
}
