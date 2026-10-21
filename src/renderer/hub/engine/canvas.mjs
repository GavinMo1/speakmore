// 引擎页的画布：树按舒展的间距排在一块 world 里，整块平移、缩放（写 world 的 transform）。
// 拖动平移（移动超过 4 像素才算拖，免得误点）；触控板两指平移、捏合缩放；鼠标滚轮平移，按住 ⌘ / Ctrl 滚动缩放。
// 详情停在画布右边、不跟着缩放：打开时把点开的那一项挪到详情左边（focus）。
// 缩放的算法单独导出（fitView、zoomAround），单元测试在 Node 里跑。

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.6;
export const clampZoom = (k) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

/** 拖动多远才算拖：再近就当点了一下 */
const DRAG_SLOP = 4;
/** 详情左边和点开的那一项之间留多宽；连线接在详情左边离顶上多远的地方 */
const DOCK_GAP = 56;
export const DOCK_ANCHOR = 34;

/**
 * 整棵树放进画布、居中。左右只留一点边，上下给图例和缩放条留地方（底下多让出 legend）
 * @param {{ w: number, h: number, cw: number, ch: number, userK: number | null }} size
 *   w、h 树的大小；cw、ch 画布的大小；userK 用户自己调过的倍数，自动适应时不超过它（没调过不超过 100%）
 */
export function fitView({ w, h, cw, ch, userK, padX = 12, padY = 56, legend = 24 }) {
  const k = clampZoom(Math.min((cw - padX * 2) / w, (ch - padY * 2) / h, userK ?? 1));
  return { k, x: (cw - w * k) / 2, y: (ch - legend - h * k) / 2 };
}

/** 以画布上的 (cx, cy) 为中心缩放到 k：那一点对着的还是树上同一点 */
export function zoomAround(view, k, cx, cy) {
  const next = clampZoom(k);
  return { k: next, x: cx - (cx - view.x) * (next / view.k), y: cy - (cy - view.y) * (next / view.k) };
}

/**
 * 元素在某个祖先里的位置，按排版算（不受 transform 影响，过渡到一半量也准）
 * @returns {{ left: number, top: number, right: number, width: number, height: number }}
 */
export function offsetIn(el, ancestor) {
  let left = 0;
  let top = 0;
  for (let node = el; node && node !== ancestor; node = node.offsetParent) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top, right: left + el.offsetWidth, width: el.offsetWidth, height: el.offsetHeight };
}

/**
 * @param {object} options
 * @param {HTMLElement} options.canvas 画布（不带框、铺满的那一块）
 * @param {HTMLElement} options.world 里面整块平移、缩放的那一层
 * @param {HTMLElement} options.content 要放进画布的东西（树）
 * @param {HTMLElement} options.zoomValue 显示百分比的那个按钮
 * @param {(ms: number) => void} options.onMove 视角变了：画布这一层的连线要跟着重画，过渡多久
 * @param {(event: Event) => boolean} [options.ignore] 这一下按在哪些东西上时不算拖（详情、缩放条）
 */
export function createCanvas({ canvas, world, content, zoomValue, onMove, ignore = () => false }) {
  /** world 平移到 (x, y)、缩放 k；userK 是用户自己调过的倍数 */
  const view = { x: 0, y: 0, k: 1, userK: null };

  function apply({ animate = false } = {}) {
    world.toggleAttribute("data-animate", animate);
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    zoomValue.textContent = `${Math.round(view.k * 100)}%`;
    onMove(animate ? 360 : 0);
  }

  /** 整棵树放进画布，居中 */
  function fit({ animate = true } = {}) {
    // 页面藏着时量不出大小：等显示出来再放
    if (canvas.clientWidth === 0) return;
    Object.assign(
      view,
      fitView({
        w: content.offsetWidth,
        h: content.offsetHeight,
        cw: canvas.clientWidth,
        ch: canvas.clientHeight,
        userK: view.userK,
      }),
    );
    apply({ animate });
  }

  /**
   * 打开详情：倍数不变，把点开的那一项挪到详情左边；详情停在和它差不多高的地方，连线基本是平的
   * @param {HTMLElement} leaf 点开的那一项
   * @param {HTMLElement} dock 停详情的那一格（画布这一层，不缩放）
   */
  function focus(leaf, dock, { animate = true } = {}) {
    const card = dock.firstElementChild;
    if (!leaf || !card || canvas.clientWidth === 0) return fit({ animate });
    const ch = canvas.clientHeight;
    const box = offsetIn(leaf, world);
    const center = box.top + box.height / 2;
    view.x = dock.offsetLeft - DOCK_GAP - box.right * view.k;
    // 那一项还在画布里就不上下挪，跑出去了才拉回来
    const y = view.y + center * view.k;
    if (y < 48 || y > ch - 72) view.y = ch / 2 - center * view.k;
    const leafY = view.y + center * view.k;
    const top = Math.min(Math.max(12, leafY - DOCK_ANCHOR), Math.max(12, ch - card.offsetHeight - 60));
    dock.style.top = `${top}px`;
    apply({ animate });
  }

  function zoomAt(k, cx, cy, { animate = false } = {}) {
    Object.assign(view, zoomAround(view, k, cx, cy));
    view.userK = view.k;
    apply({ animate });
  }

  const center = () => [canvas.clientWidth / 2, canvas.clientHeight / 2];

  // 触控板：两指滑动平移，捏合（浏览器报成按着 ctrl 的滚轮）缩放；鼠标滚轮按住 ⌘ / Ctrl 缩放
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (ignore(event)) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        zoomAt(view.k * Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
        return;
      }
      view.x -= event.deltaX;
      view.y -= event.deltaY;
      apply();
    },
    { passive: false },
  );

  // 拖动平移：按下后移动超过 4 像素才算拖，松手时吞掉这一次点击，免得拖完误点开节点
  let drag = null;
  let swallowClick = false;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || ignore(event)) return;
    drag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, x: view.x, y: view.y, moving: false };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.sx;
    const dy = event.clientY - drag.sy;
    if (!drag.moving && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!drag.moving) {
      drag.moving = true;
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.dragging = "";
    }
    view.x = drag.x + dx;
    view.y = drag.y + dy;
    apply();
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    // 只吞紧跟着松手的那一下点击：拖完不一定有点击（按下、松开不在同一个元素上就没有），
    // 留着这个记号会吃掉下一次正常的点击
    if (drag.moving) {
      swallowClick = true;
      setTimeout(() => {
        swallowClick = false;
      });
    }
    delete canvas.dataset.dragging;
    drag = null;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener(
    "click",
    (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );

  return {
    view,
    fit,
    focus,
    zoomIn: () => zoomAt(view.k * 1.2, ...center(), { animate: true }),
    zoomOut: () => zoomAt(view.k / 1.2, ...center(), { animate: true }),
    reset: () => zoomAt(1, ...center(), { animate: true }),
    /** 适应画布：忘掉用户调过的倍数 */
    forgetZoom: () => {
      view.userK = null;
    },
  };
}
