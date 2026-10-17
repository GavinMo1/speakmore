import { t } from "../shared/i18n.mjs";
import { describeError } from "../shared/setup-text.mjs";
import { drawnCheck, h, svg } from "./dom.mjs";

// 检测的一套状态（界面规范第 4 节）：未检测是描边按钮（检测），检测中转圈，结果是可再点的徽标
// （检测通过 / 检测失败，悬停换成"重新检测"）；失败的原因用说明框挂在那一行下面。
// 模型库的每一行、密钥表、推荐组合共用。结果按键记着，重画时照着画。

const label = (text) => h("span", { class: "label", text });

/**
 * @param {() => void} redraw 结果变了，重画用到它的那一块
 */
export function createChecks(redraw) {
  /** 键 → { state: running | ok | fail, problem, title, fresh }。没检测过的没有这一项 */
  const results = {};

  async function run(key, call) {
    results[key] = { state: "running" };
    redraw();
    let result;
    try {
      result = await call();
    } catch (error) {
      result = { ok: false, problem: describeError(error) };
    }
    results[key] = result.ok ? { state: "ok", fresh: true } : { state: "fail", problem: result.problem };
    redraw();
    // 对勾只在刚通过的那一下画出来，之后重画时是静止的
    if (results[key]) results[key].fresh = false;
  }

  /**
   * 状态那一格里的控件
   * @param {string} key
   * @param {string} tip 悬停说检测的是什么
   * @param {() => Promise<{ ok: boolean, problem?: object }>} call
   */
  function control(key, tip, call) {
    const result = results[key];
    const again = () => run(key, call);
    if (!result) {
      return h(
        "button",
        { type: "button", class: "check block", title: tip, onclick: again },
        svg("i-activity"),
        label(t("plaza.check.run")),
      );
    }
    if (result.state === "running") {
      return h(
        "span",
        { class: "badge block", "data-tone": "progress", role: "status", title: tip },
        svg("i-loader-circle", "icon spin"),
        label(t("plaza.check.running")),
      );
    }
    const ok = result.state === "ok";
    return h(
      "button",
      {
        type: "button",
        class: "badge block",
        "data-tone": ok ? "ok" : "problem",
        "data-fresh": Boolean(result.fresh),
        "aria-label": t(ok ? "plaza.check.okAgain" : "plaza.check.failAgain"),
        onclick: again,
      },
      h(
        "span",
        { class: "badge-face" },
        ok ? (result.fresh ? drawnCheck() : svg("i-check")) : svg("i-circle-alert"),
        label(t(ok ? "plaza.check.ok" : "plaza.check.fail")),
      ),
      h("span", { class: "badge-hover" }, svg("i-rotate-cw"), label(t("plaza.check.again"))),
    );
  }

  /** 失败说明：在出问题的那一行下面；没失败是 null */
  function note(key) {
    const result = results[key];
    if (result?.state !== "fail") return null;
    return h(
      "p",
      { class: "callout", role: "alert" },
      svg("i-circle-alert"),
      h("span", {}, h("b", { text: t(result.title ?? "plaza.check.fail") }), ` · ${t.text(result.problem)}`),
    );
  }

  return { results, run, control, note };
}
