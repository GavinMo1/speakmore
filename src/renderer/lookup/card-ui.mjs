// 划词卡片的画面：给一份样子（app/lookup/controller.mjs 的 view），画进 card.html。不找主进程：
// 量高度、报要截的几块、收点击在 card.mjs；首次引导的演示（onboarding/demo/card.mjs）也用它画，样子和真卡片一样。

import { languageName } from "../../languages.mjs";
import { $, h } from "../shared/dom.mjs";
import { t } from "../shared/i18n.mjs";

/**
 * @param {object | null} view 这一次的样子；没开着是 null
 * @param {{ menuOpen?: boolean }} [options] 语言选单展开着没有
 */
export function drawCard(view, { menuOpen = false } = {}) {
  document.body.dataset.phase = view ? view.phase : "hidden";
  if (!view) return;
  const { phase, language, languages = [], text, problem, action, pinned = false } = view;
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
}
