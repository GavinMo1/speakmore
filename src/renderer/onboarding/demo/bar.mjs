// 首次引导演示里的悬浮条：真的 bar-ui.mjs 画，不录音、不连服务、不找主进程。引导页（scene.mjs）发消息驱动：
//   { type: "show", view, feature, keys, to }   换成这种样子；feature 是 dictate / translate，keys 是这个功能的组合（code），
//                                               to 是语音翻译那个胶囊上写的目标语言
//   { type: "level", value }                     正在听时的一个瞬时音量（0–1）
//   { type: "hide" }
// 加载好了先报一声 bar-ready，引导页等到它才开始放
import { chordKeycaps } from "../../../hotkeys/chord.mjs";
import { createBarUi } from "../../bar/bar-ui.mjs";
import { translate } from "../../bar/features/translate.mjs";
import { localize, t } from "../../shared/i18n.mjs";

const keycaps = (codes) => chordKeycaps(codes).map((cap) => t.text(cap));
const ESC = keycaps(["Escape"]);

localize();
const ui = createBarUi({
  document,
  host: { setVisible() {}, capture() {} },
  keys: { keys: keycaps(["AltRight"]), escKeys: ESC },
  t,
});
ui.setControls(true);

window.addEventListener("message", ({ source, data }) => {
  if (source !== parent) return;
  if (data?.type === "show") {
    ui.setKeys({ keys: keycaps(data.keys), escKeys: ESC });
    if (data.feature === "translate") {
      ui.setFeature({ chip: translate.chip(translate.open({ translateTo: data.to })), finishing: translate.finishing });
    } else ui.setFeature({ chip: null, finishing: null });
    ui.show(data.view);
  } else if (data?.type === "level") ui.level(data.value);
  else if (data?.type === "hide") ui.show("hidden");
});
parent.postMessage({ type: "bar-ready" }, "*");
