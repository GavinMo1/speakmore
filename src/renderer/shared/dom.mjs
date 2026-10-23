import { t } from "./i18n.mjs";
import { providerIcon } from "./provider-icons.mjs";

// 用代码画的几块（主窗口的引擎页、推荐组合，首次引导）共用的小工具：拼节点、取图标、按界面语言写厂商名。

const NS = "http://www.w3.org/2000/svg";

export const $ = (id) => document.getElementById(id);

/** 页面顶上那份图标表（各页面 html 里的 .sprite）里的一个 */
export function svg(id, className = "icon") {
  const node = document.createElementNS(NS, "svg");
  node.setAttribute("class", className);
  node.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `#${id}`);
  node.append(use);
  return node;
}

/** 刚通过检测的对勾要画出来：路径得在文档里（<use> 里的路径样式够不着） */
export function drawnCheck() {
  const node = document.createElementNS(NS, "svg");
  node.setAttribute("class", "icon");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M20 6L9 17l-5-5");
  node.append(path);
  return node;
}

/**
 * 填下拉框（window.css 的 .select，用 appearance: base-select 画）：最前面一个按钮，里面是选中那一项的字
 * （selectedcontent 跟着选中的变）和箭头；后面是选项。打开后的单子也由样式画，Mac、Windows 一个样子
 * @param {HTMLSelectElement} select
 * @param {Array<[string, string]>} choices [值, 写什么]
 * @param {string} current 选中的那个值
 */
export function fillSelect(select, choices, current) {
  select.replaceChildren(
    h("button", { type: "button" }, document.createElement("selectedcontent"), svg("i-chevron", "icon chevron")),
    ...choices.map(([value, label]) => new Option(label, value, false, value === current)),
  );
}

/** 品牌图标：认识的家用它的图标，不认识的用一朵云 */
export const brand = (id) => providerIcon(id) ?? svg("i-cloud");

/** 拼一个节点：值是 false、null、undefined 的属性和子节点不写 */
export function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") node.style.cssText = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
  return node;
}

/** 文案里有就用文案，没有就用给的名字（新接的平台、做模型的家还没写进文案时） */
export function named(key, fallback) {
  const text = t(key);
  return text === key ? fallback : text;
}

/** 平台（卖模型、收 key 的那一家）按界面语言叫什么 */
export const platformName = (platform) => named(`providers.${platform.id}.name`, platform.name);

/** 下载进度：底色铺到下了多少，写百分比（模型库那一行、推荐组合里都用） */
export function progressBadge(download) {
  const p = download.total ? download.received / download.total : 0;
  return h(
    "span",
    {
      class: "badge block",
      "data-tone": "progress",
      style: `--p: ${p}`,
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": String(Math.round(p * 100)),
    },
    svg("i-download"),
    h("span", { class: "label", text: `${Math.round(p * 100)}%` }),
  );
}
