import { $ } from "../shared/dom.mjs";

// 窗口底部一闪而过的那句话（hub.html 的 #toast）：操作成功了说一声，几秒后自己收起。

let timer;

/** @param {string} text */
export function toast(text) {
  const node = $("toast");
  // 开着模态对话框（密钥面板、设置）时，对话框外面的都压在它和遮罩下面、读屏也读不到：挪进对话框里说
  const host = document.querySelector("dialog:modal") ?? document.body;
  if (node.parentElement !== host) host.append(node);
  node.textContent = text;
  node.removeAttribute("data-hidden");
  clearTimeout(timer);
  timer = setTimeout(() => node.setAttribute("data-hidden", ""), 2400);
}
