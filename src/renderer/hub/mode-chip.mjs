import { $, h, svg } from "../shared/dom.mjs";
import { t } from "../shared/i18n.mjs";
import { modeName } from "./engine/plaza-view.mjs";

// 首页标题右边的识别方式：只显示正在用哪一种，点一下去引擎页换（引擎页的第一列就是识别方式）。
// 前面一个小圆点：齐了是绿色，还差什么（缺密钥、没下载）是红色（朱砂的主题色本身偏红，不拿它表示齐了）；
// 差的是什么由顶上的横幅说，这里不重复。

/**
 * @param {object} options
 * @param {() => void} options.open 去引擎页
 */
export function createModeChip({ open }) {
  const chip = $("mode-chip");
  chip.addEventListener("click", open);

  return {
    /** @param {object} setup getSetup 给的整份状态 */
    render(setup) {
      if (!setup?.plaza) return;
      const mode = setup.plaza.mode;
      const way = setup.plaza.ways[mode];
      const ready = !way.problem && way.needs.length === 0;
      chip.replaceChildren(
        h("span", { class: "dot", "data-tone": ready ? "ok" : "problem", "aria-hidden": "true" }),
        h("span", { class: "picker-trigger-label", text: t("home.mode.label") }),
        h("span", { class: "picker-trigger-value", text: modeName(mode) }),
        svg("i-chevron", "icon chevron"),
      );
      chip.title = t("home.mode.open");
      chip.setAttribute("aria-label", `${t("home.mode.label")} · ${modeName(mode)} · ${t("home.mode.open")}`);
    },
  };
}
