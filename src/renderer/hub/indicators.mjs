// 滑块：分类标签的下划线、分段控件的底块（window.css 的 .indicator），从上一个位置滑到新位置。
// 宿主写 data-indicator="<名字>"，第一个孩子是 .indicator，选中的那一项带 aria-selected 或 aria-checked。

/**
 * @param {ParentNode} root 在哪一块里找宿主（每页一块，各记各的上一个位置）
 * @returns {{ place: () => void, reset: () => void }} place：按选中的那一项放好；reset：忘掉上一个位置
 *   （页面从隐藏变成显示、窗口变宽变窄之后，旧位置量的是另一种排版，不能从那里滑过来）
 */
export function slidingIndicators(root) {
  const lastPlace = new Map();

  function place() {
    for (const host of root.querySelectorAll("[data-indicator]")) {
      const ink = host.querySelector(":scope > .indicator");
      const on = host.querySelector(':scope > [aria-selected="true"], :scope > [aria-checked="true"]');
      if (!ink) continue;
      ink.hidden = !on;
      // 页面藏着时量不出宽度：等它显示出来再放
      if (!on || on.offsetWidth === 0) continue;
      const next = { x: on.offsetLeft, w: on.offsetWidth };
      const prev = lastPlace.get(host.dataset.indicator) ?? next;
      ink.style.transition = "none";
      ink.style.setProperty("--x", `${prev.x}px`);
      ink.style.setProperty("--w", `${prev.w}px`);
      ink.getBoundingClientRect();
      ink.style.transition = "";
      ink.style.setProperty("--x", `${next.x}px`);
      ink.style.setProperty("--w", `${next.w}px`);
      lastPlace.set(host.dataset.indicator, next);
    }
  }

  const reset = () => lastPlace.clear();
  addEventListener("resize", () => {
    reset();
    place();
  });
  return { place, reset };
}
