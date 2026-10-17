import { t } from "../shared/i18n.mjs";
import { describeError } from "../shared/setup-text.mjs";
import { $, brand, h, platformName, svg } from "./dom.mjs";
import { toast } from "./toast.mjs";

// 首页的识别方式选单：标题右边一个按钮写着正在用哪种方式，点开是一张浮层，三种方式三选一。
// 每种方式写着一路经过哪几个模型；切过去之前还差什么（缺 key、没下载、自定义服务没写地址）先写出来，
// 带一个去模型页配置的按钮。切换交给主进程（app/modes.mjs 的 switchMode），验证过才换：没通过就在那一项下面
// 照实说为什么，同样给去配置的按钮。各种方式里用哪个模型在模型页换，这里不换。
// 数据随 getSetup 来（app/model-plaza.mjs 的 ways）。

const MODES = ["native", "local", "private"];
const ICONS = { native: "i-sparkles", local: "i-wand-sparkles", private: "i-shield-check" };
/** 去模型页配置某种方式时先看哪一类：它的第一跳 */
const FIRST_TAB = { native: "native", local: "transcribe", private: "transcribe" };

/**
 * @param {object} options
 * @param {() => Promise<object>} options.refresh 重读状态，整个窗口跟着更新
 * @param {(target: { tab: string, platform?: string }) => void} options.configure
 *   去模型页的某一类；是密钥表时可以顺带展开某个平台的表单
 */
export function createModePicker({ refresh, configure }) {
  /** 最近一次拿到的状态 */
  let setup = null;
  /** 正在切过去的那一种；没在切是 null */
  let busy = null;
  /** 上一次没切成：{ mode, problem }。浮层收起就忘掉 */
  let failure = null;

  const trigger = $("mode-trigger");
  const panel = $("mode-picker");

  const modeName = (mode) => t(`plaza.modes.${mode}`);
  const current = () => setup.plaza.mode;
  const wayOf = (mode) => setup.plaza.ways[mode];
  const platformOf = (id) => setup.plaza.platforms.find((platform) => platform.id === id) ?? { id, name: id };
  const isOpen = () => panel.matches(":popover-open");

  /**
   * 去配置时先去哪：缺 key 去密钥表展开那一家，没下载去转写那一排，自定义服务没写地址去润色那一排。
   * 不知道缺什么（key 没通过、够不着）时去这一路最后那家的密钥；一家都不用（数据隐私）就去它的第一跳
   */
  function fixTarget(mode) {
    const [need] = wayOf(mode).needs;
    if (need?.kind === "key") return { tab: "keys", platform: need.platform };
    if (need?.kind === "download") return { tab: "transcribe" };
    if (need?.kind === "url") return { tab: "polish" };
    const keyed = wayOf(mode).hops.findLast(({ platform }) => platform !== "local");
    return keyed ? { tab: "keys", platform: keyed.platform } : { tab: FIRST_TAB[mode] };
  }

  function go(target) {
    panel.hidePopover();
    configure(target);
  }

  function needText(mode, need) {
    if (need.kind === "key") return t("home.mode.needs.key", { platform: platformName(platformOf(need.platform)) });
    if (need.kind === "download") {
      const hop = wayOf(mode).hops.find(({ platform }) => platform === "local");
      return t("home.mode.needs.download", { model: hop?.name ?? need.model });
    }
    return t("home.mode.needs.url");
  }

  /** 一路上的一个模型：前面有箭头（第一个没有）、图标、名字，悬停说在哪个平台上 */
  function hop({ platform, maker, name }, index) {
    const where = platform === "local" ? t("plaza.via.local") : platformName(platformOf(platform));
    const text = platform === "custom" ? `${t("plaza.custom.name")} · ${name}` : name;
    return h(
      "span",
      { class: "hop", title: `${text} · ${where}` },
      index > 0 && h("span", { class: "hop-arrow", "aria-hidden": "true", text: "→" }),
      brand(maker ?? platform),
      h("span", { class: "hop-name", text }),
    );
  }

  function hops(mode) {
    const list = wayOf(mode).hops.map(hop);
    return list.length > 0 ? h("span", { class: "hops" }, list) : null;
  }

  /** 一项下面的说明：没切成的原因，或者切过去之前还差的；都带去配置的按钮 */
  function note(mode) {
    const way = wayOf(mode);
    const fix = h("button", {
      type: "button",
      class: "button small",
      text: t("home.mode.fix"),
      onclick: () => go(fixTarget(mode)),
    });
    if (failure?.mode === mode) {
      return h(
        "div",
        { class: "mode-note callout", role: "alert" },
        svg("i-circle-alert"),
        h("span", {}, h("b", { text: t("home.mode.failed") }), ` · ${t.text(failure.problem)}`),
        fix,
      );
    }
    const gaps = way.problem ? [t.text(way.problem)] : way.needs.map((need) => needText(mode, need));
    if (gaps.length === 0) return null;
    return h(
      "div",
      { class: "mode-note" },
      svg("i-circle-alert"),
      h("span", { text: gaps.join(" · ") }),
      !way.problem && fix,
    );
  }

  function option(mode) {
    const live = current() === mode;
    const switching = busy === mode;
    return h(
      "div",
      { class: "mode-item" },
      h(
        "button",
        {
          type: "button",
          class: "mode-option",
          role: "radio",
          "aria-checked": String(live),
          "aria-busy": switching ? "true" : null,
          disabled: !setup.switchable || (busy !== null && !switching),
          onclick: () => pick(mode),
        },
        h("span", { class: "mode-glyph" }, svg(ICONS[mode])),
        h(
          "span",
          { class: "mode-option-body" },
          h(
            "span",
            { class: "mode-option-title" },
            h("span", { class: "mode-option-name", text: modeName(mode) }),
            live && h("span", { class: "tag", "data-tone": "accent", text: t("plaza.inUse") }),
            switching &&
              h(
                "span",
                { class: "tag", role: "status" },
                svg("i-loader-circle", "icon spin"),
                t("home.mode.switching"),
              ),
          ),
          h("span", { class: "mode-option-desc", text: t(`home.mode.desc.${mode}`) }),
          hops(mode),
        ),
        h("span", { class: "radio-mark" }, svg("i-check")),
      ),
      note(mode),
    );
  }

  function draw() {
    if (!setup?.plaza?.ways) return;
    const mode = current();
    trigger.replaceChildren(
      h("span", { class: "mode-glyph" }, svg(ICONS[mode])),
      h("span", { class: "mode-trigger-label", text: t("home.mode.label") }),
      h("span", { class: "mode-trigger-value", text: modeName(mode) }),
      svg("i-chevron", "icon chevron"),
    );
    trigger.setAttribute("aria-label", `${t("home.mode.label")} · ${modeName(mode)}`);
    $("mode-options").replaceChildren(...MODES.map(option));
    $("mode-locked").hidden = setup.switchable;
    $("mode-configure").replaceChildren(svg("i-sliders"), t("home.mode.configure", { mode: modeName(mode) }));
  }

  async function pick(mode) {
    if (busy !== null) return;
    if (mode === current()) {
      panel.hidePopover();
      return;
    }
    busy = mode;
    failure = null;
    draw();
    let result;
    try {
      result = await window.speakmore.setMode(mode);
    } catch (error) {
      result = { ok: false, problem: describeError(error) };
    }
    busy = null;
    if (result?.ok === false) {
      failure = { mode, problem: result.problem };
      draw();
      // 等的时候浮层被点掉了：原因还是要说
      if (!isOpen()) toast(`${t("home.mode.failed")} · ${t.text(result.problem)}`);
      return;
    }
    panel.hidePopover();
    toast(t("home.mode.switched", { mode: modeName(mode) }));
    await refresh();
    if (result?.note) toast(t.text(result.note));
  }

  panel.addEventListener("toggle", (event) => {
    trigger.setAttribute("aria-expanded", String(event.newState === "open"));
    if (event.newState === "closed" && busy === null && failure !== null) {
      failure = null;
      draw();
    }
  });
  $("mode-configure").addEventListener("click", () => go({ tab: FIRST_TAB[current()] }));

  return {
    /** @param {object} next getSetup 给的整份状态 */
    render(next) {
      setup = next;
      draw();
    },
  };
}
