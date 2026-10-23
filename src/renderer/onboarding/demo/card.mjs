// 首次引导演示里的划词卡片：真的 card-ui.mjs 画，不找主进程。引导页（scene.mjs）发消息驱动：
//   { type: "show", phase, language, text }   phase：hidden / loading / done
// 加载好了先报一声 card-ready
import { drawCard } from "../../lookup/card-ui.mjs";
import { localize } from "../../shared/i18n.mjs";

localize();
drawCard(null);
window.addEventListener("message", ({ source, data }) => {
  if (source !== parent || data?.type !== "show") return;
  drawCard(data.phase === "hidden" ? null : { phase: data.phase, language: data.language, text: data.text });
});
parent.postMessage({ type: "card-ready" }, "*");
