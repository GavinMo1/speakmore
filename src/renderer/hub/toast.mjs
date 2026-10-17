import { $ } from "./dom.mjs";

// 窗口底部一闪而过的那句话（hub.html 的 #toast）：操作成功了说一声，几秒后自己收起。

let timer;

/** @param {string} text */
export function toast(text) {
  const node = $("toast");
  node.textContent = text;
  node.removeAttribute("data-hidden");
  clearTimeout(timer);
  timer = setTimeout(() => node.setAttribute("data-hidden", ""), 2400);
}
