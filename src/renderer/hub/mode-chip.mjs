import { $, h, svg } from "../shared/dom.mjs";
import { t } from "../shared/i18n.mjs";
import { MODE_ICONS, modeName } from "./engine/plaza-view.mjs";

// 首页标题右边的识别方式：只显示正在用哪一种，点一下去引擎页换（引擎页的第一列就是识别方式）。
// 还差什么（缺密钥、没下载）由顶上的横幅说，这里不重复。

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
      chip.replaceChildren(
        svg(MODE_ICONS[mode]),
        h("span", { class: "picker-trigger-label", text: t("home.mode.label") }),
        h("span", { class: "picker-trigger-value", text: modeName(mode) }),
        svg("i-chevron", "icon chevron"),
      );
      chip.title = t("home.mode.open");
      chip.setAttribute("aria-label", `${t("home.mode.label")} · ${modeName(mode)} · ${t("home.mode.open")}`);
    },
  };
}
