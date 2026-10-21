import { $, brand, h, svg } from "../../shared/dom.mjs";
import { t } from "../../shared/i18n.mjs";
import { itemKey, itemName, makerName, roleName, searchPlaza } from "./plaza-view.mjs";

// 引擎页标题行的搜索：结果列在搜索框下面，上下键挑、回车选；选一个就沿树展开到它、打开详情。

/** 最多列几条：再多就该再打几个字了 */
const LIMIT = 8;

/**
 * @param {object} ctx 引擎页（page.mjs）
 */
export function createSearch(ctx) {
  const input = $("plaza-search");
  const box = $("search-results");
  let index = 0;
  let hits = [];

  function choose(hit) {
    input.value = "";
    setOpen(false);
    ctx.reveal(hit.role, hit.group.id, itemKey(hit.item));
  }

  function setOpen(open) {
    box.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (!open) input.removeAttribute("aria-activedescendant");
  }

  function render() {
    const query = input.value;
    if (!query.trim() || !ctx.setup?.plaza) {
      setOpen(false);
      return;
    }
    hits = searchPlaza(ctx.setup.plaza, query).slice(0, LIMIT);
    index = Math.min(index, Math.max(0, hits.length - 1));
    setOpen(true);
    if (hits.length === 0) {
      box.replaceChildren(h("p", { class: "search-empty", text: t("plaza.empty.title") }));
      return;
    }
    box.replaceChildren(
      ...hits.map((hit, at) =>
        h(
          "button",
          {
            type: "button",
            class: "search-hit",
            role: "option",
            id: `search-hit-${at}`,
            "aria-selected": String(at === index),
            // 按下时不让搜索框失焦，不然结果先收起、点不到
            onmousedown: (event) => event.preventDefault(),
            onclick: () => choose(hit),
          },
          h(
            "span",
            { class: "logo-tile", "data-size": "sm" },
            hit.group.kind === "local"
              ? brand(hit.item.maker)
              : hit.group.kind === "custom"
                ? brand("custom")
                : brand(hit.group.id),
          ),
          h(
            "span",
            { class: "search-hit-text" },
            h("span", { class: "search-hit-name", text: itemName(hit.group, hit.item, { withBuild: true }) }),
            h("span", { class: "search-hit-meta", text: `${roleName(hit.role)} · ${makerName(hit.group)}` }),
          ),
          svg("i-chevron", "icon search-hit-go"),
        ),
      ),
    );
    input.setAttribute("aria-activedescendant", `search-hit-${index}`);
  }

  input.addEventListener("input", () => {
    index = 0;
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (hits.length === 0) return;
      index = (index + (event.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!box.hidden && hits[index]) choose(hits[index]);
    } else if (event.key === "Escape" && input.value) {
      // 只清搜索，不让 Esc 再收起详情
      event.stopPropagation();
      input.value = "";
      setOpen(false);
    }
  });
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => setOpen(false));

  return { render };
}
