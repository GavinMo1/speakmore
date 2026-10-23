// 划词卡片放哪（纯逻辑）。他定的：放在选区下方，左边对齐选区；下方放不下就翻到上方。不出设置。
// 拿不到选区位置时（模拟复制取的字）放在鼠标下方：他多半刚用鼠标选完，鼠标就停在选区末尾。
// 坐标都是 Electron 的屏幕坐标（DIP），workArea 是选区所在那块屏去掉菜单栏、程序坞、任务栏后的可用区域。

/** 卡片和选区之间空多少 */
const GAP = 8;
/** 卡片离可用区域的边至少多远 */
const MARGIN = 8;
/** 鼠标指针本身大约这么高：放在鼠标下方时让开它 */
const POINTER_HEIGHT = 20;

const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * @param {object} options
 * @param {{ x: number, y: number, width: number, height: number } | null} options.selection 选区的外接框；不知道是 null
 * @param {{ x: number, y: number } | null} options.pointer 鼠标在哪（不知道选区时用）
 * @param {{ width: number, height: number }} options.size 卡片多大
 * @param {{ x: number, y: number, width: number, height: number }} options.workArea
 * @returns {{ x: number, y: number, above: boolean }} 卡片左上角；above 是不是翻到了上方
 */
export function placeCard({ selection, pointer, size, workArea }) {
  const top = selection ? selection.y : pointer.y;
  const below = selection ? selection.y + selection.height + GAP : pointer.y + POINTER_HEIGHT;
  const floor = workArea.y + workArea.height - MARGIN;
  const ceiling = workArea.y + MARGIN;
  const left = selection ? selection.x : pointer.x;
  const x = clamp(left, workArea.x + MARGIN, workArea.x + workArea.width - MARGIN - size.width);
  if (below + size.height <= floor) return { x, y: below, above: false };
  const above = top - GAP - size.height;
  if (above >= ceiling) return { x, y: above, above: true };
  // 上下都放不下：贴着底边放，盖住一部分选区也比出了屏幕强
  return { x, y: clamp(floor - size.height, ceiling, floor - size.height), above: false };
}
