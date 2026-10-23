// 划词卡片的页面：主进程交来这一次的样子（app/lookup/controller.mjs 的 view），这里画出来，量好卡片多高、
// 每个按钮在窗口里的哪一块，报回去（app/lookup/card-window.mjs 摆窗口、交给小帮手截）。
// 窗口点不到：点击是小帮手截下来、经主进程转过来的（onLookupClick）。展开语言选单这种只在页面里的事这里自己办，
// 别的（复制、换语言、固定、关闭、重试、配置密钥）报给主进程。

import { languageName } from "../../languages.mjs";
import { $, h } from "../shared/dom.mjs";
import { localize, setLocale, t } from "../shared/i18n.mjs";

/** "已复制"留多久 */
const COPIED_MS = 1500;

localize();
const card = $("card");

/** 现在画的样子；没开着是 null */
let view = null;
/** 语言选单展开着没有：换一张卡片（view.id 变了）就收起 */
let menuOpen = false;
let copiedTimer = null;

function render() {
  document.body.dataset.phase = view ? view.phase : "hidden";
  if (!view) return;
  const { phase, language, languages, text, problem, action, pinned } = view;
  $("language-name").textContent = t.text(languageName(language));
  $("language").setAttribute("aria-expanded", String(menuOpen));
  $("pin").setAttribute("aria-pressed", String(pinned));
  $("pin").setAttribute("aria-label", t(pinned ? "lookup.card.unpin" : "lookup.card.pin"));

  const menu = $("menu");
  menu.hidden = !menuOpen;
  if (menuOpen) {
    menu.replaceChildren(
      ...languages.map((id) =>
        h("span", {
          class: "menu-item",
          role: "option",
          "aria-selected": String(id === language),
          "data-region": `pick:${id}`,
          text: t.text(languageName(id)),
        }),
      ),
    );
  }

  $("loading").hidden = phase !== "loading";
  $("text").hidden = phase !== "done";
  $("text").textContent = phase === "done" ? text : "";
  $("problem").hidden = phase !== "error";
  $("problem-text").textContent = phase === "error" ? t.text(problem) : "";
  $("foot").hidden = phase === "loading";
  $("copy").hidden = phase !== "done";
  $("keys").hidden = !(phase === "error" && action === "keys");
  $("retry").hidden = !(phase === "error" && action === "retry");
  report();
}

/** 这一块在窗口里的位置：没有动画（卡片只淡入），量出来的就是排好的位置 */
function regionOf(node) {
  const box = node.getBoundingClientRect();
  return { id: node.dataset.region, x: box.left, y: box.top, width: box.width, height: box.height };
}

/** 报卡片多高、哪几块要截：按钮在前，整张卡片最后（点在卡片的空白处也不能漏到下面的应用里，也不算点别处） */
function report() {
  if (!view) return;
  const buttons = [...card.querySelectorAll("[data-region]")].filter((node) => node.getClientRects().length > 0);
  const regions = [...buttons.map(regionOf), { ...regionOf(card), id: "card" }];
  window.speakmore.lookupLayout({ height: card.offsetHeight, regions });
}

function showCopied() {
  clearTimeout(copiedTimer);
  $("copy-label").textContent = t("lookup.card.copied");
  $("copy").querySelector("use").setAttribute("href", "#i-check");
  copiedTimer = setTimeout(() => {
    $("copy-label").textContent = t("lookup.card.copy");
    $("copy").querySelector("use").setAttribute("href", "#i-copy");
  }, COPIED_MS);
}

window.speakmore.onLookupView((next) => {
  if (!next || next.id !== view?.id) menuOpen = false;
  view = next;
  render();
});

window.speakmore.onLookupClick((id) => {
  if (!view) return;
  if (id === "language") {
    menuOpen = !menuOpen;
    render();
    return;
  }
  if (id === "card") {
    // 点在卡片的空白处：收起展开着的语言选单
    if (menuOpen) {
      menuOpen = false;
      render();
    }
    return;
  }
  if (id.startsWith("pick:")) {
    menuOpen = false;
    render();
  }
  if (id === "copy") showCopied();
  window.speakmore.lookupAct(id);
});

// 卡片变高变矮（译文回来、展开选单、换了界面语言）都重报一次
new ResizeObserver(() => report()).observe(card);

// 译文长到要滚动时：指针停在译文上，让窗口收鼠标（滚轮才滚得动）；离开就还给下面的应用
const text = $("text");
text.addEventListener("pointerenter", () => {
  if (text.scrollHeight > text.clientHeight) window.speakmore.lookupScroll(true);
});
text.addEventListener("pointerleave", () => window.speakmore.lookupScroll(false));

window.speakmore.onLocaleChanged((locale) => {
  setLocale(locale);
  localize();
  render();
});
