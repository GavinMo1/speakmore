import { t } from "../shared/i18n.mjs";
import { describeError } from "../shared/setup-text.mjs";
import { createChecks } from "./checks.mjs";
import { $, brand, h, named, platformName, progressBadge, svg } from "./dom.mjs";
import { slidingIndicators } from "./indicators.mjs";
import { toast } from "./toast.mjs";

// 侧栏"模型"一页：模型库，按角色分三排货架（原生、转写、润色）加一张密钥表；标题行右边的推荐组合在 preset-picker.mjs。货架按谁做的分组，
// 一组可能有好几个平台卖，平台是这一组的渠道。选哪种识别方式不在这里，在首页（mode-picker.mjs）：
// 这里换的是各种方式里用的模型，启用另一种方式里的模型时连方式一起换（toolbar 上方那行说明会先讲清楚）。
// 数据由主进程拼好（app/model-plaza.mjs，随 getSetup 来），这里只画、只转达操作；换模型、存 key 都走主进程，
// 验证过才换。控件和尺寸都照界面规范（docs/desktop-ui-spec.md），文案照规范里的词表。

/**
 * 货架的三个角色 → 设置里那一项、属于哪种识别方式。转写在两种方式里都有：数据隐私方式（private）用它自己的那一项
 * （privateTranscriber），只认本机模型；见 settingOf、modeFor
 */
const ROLES = {
  native: { setting: "native", mode: "native" },
  transcribe: { setting: "transcriber", mode: "local" },
  polish: { setting: "polish", mode: "local" },
};
const TABS = ["native", "transcribe", "polish", "keys"];

/** 平台是某家自己的开放平台时，渠道上写"官方"（百炼另有名字，不算） */
const OFFICIAL = {
  deepseek: "deepseek",
  moonshot: "kimi",
  zhipu: "zhipu",
  minimax: "minimax",
  gemini: "gemini",
  openai: "openai",
};

// ---------- 小工具 ----------

const logoTile = (node) => h("span", { class: "logo-tile" }, node);

const makerName = (maker) => named(`plaza.makers.${maker}`, maker);

/** 一个价：¥0.8、$0.3；数小于 1 的保留到小数点后两位以内 */
const money = (currency) => (currency === "CNY" ? "¥" : "$");
/** 价保留到分：两位小数以内 */
const amount = (value) => Math.round(value * 100) / 100;

/**
 * @param {object} options
 * @param {() => Promise<object>} options.refresh 重新问主进程要一份状态，并让整个窗口跟着更新
 * @param {() => void} options.pickMode 回首页打开识别方式的选单
 */
export function createModels({ refresh, pickMode }) {
  /** 最近一次拿到的状态 */
  let setup = null;
  const state = {
    tab: "native",
    maker: "all",
    onlyUsable: false,
    query: "",
    /** 各组看的是哪个渠道：组 id → 平台 id。没选过的按 viaOf 推 */
    via: {},
    /** 展开了密钥表单的平台 */
    openKey: null,
    /** 自定义服务这次填的地址和模型名（存 key 时一起验，启用时一起交） */
    custom: { url: "", model: "" },
    /** 正在等主进程回话的那一次操作，按钮不重复点 */
    busy: null,
    /** 从某一排货架点"配置密钥"跳到密钥表时，那一排是哪个分类：存好 key 就回去，接着启用那一行的模型 */
    returnTo: null,
  };

  const platformOf = (id) => setup.plaza.platforms.find((platform) => platform.id === id) ?? null;
  const privateNow = () => setup.plaza.mode === "private";
  /** 这个角色现在选的写在哪一项：数据隐私方式里转写是它自己的那一项 */
  const settingOf = (role) => (role === "transcribe" && privateNow() ? "privateTranscriber" : ROLES[role].setting);
  const chosenOf = (role) => setup.plaza.chosen[settingOf(role)];
  /** 启用这一行要用哪种识别方式：数据隐私方式里启用本机模型还在它里面，别的照角色 */
  const modeFor = (role, group) =>
    role === "transcribe" && privateNow() && group.kind === "local" ? "private" : ROLES[role].mode;
  const hasKey = (id) => Boolean(platformOf(id)?.key);
  const modeName = (mode) => t(`plaza.modes.${mode}`);

  // ---------- 渠道、能不能用 ----------

  /** 这一组正在用的那个模型的渠道 */
  function chosenVia(role, group) {
    const chosen = chosenOf(role);
    for (const item of group.items) {
      for (const [via, offer] of Object.entries(item.offers ?? {})) if (offer.choice === chosen) return via;
    }
    return null;
  }

  /** 这一组看哪个渠道：选过的，否则正在用的，否则配了 key 的，否则第一个 */
  function viaOf(role, group) {
    if (group.kind !== "cloud") return group.channels[0];
    return state.via[group.id] ?? chosenVia(role, group) ?? group.channels.find(hasKey) ?? group.channels[0];
  }

  /** 这一行在这个渠道上的那一项（{ choice, price }）；这个渠道不卖它时是 null */
  const offerOf = (role, group, item) => (group.kind === "cloud" ? (item.offers[viaOf(role, group)] ?? null) : null);

  /** 这一行写进设置的样子：本机模型是 id，云端是 厂商/模型 */
  function choiceOf(role, group, item) {
    if (group.kind === "local") return item.choice;
    if (group.kind === "custom") return customChoice();
    return offerOf(role, group, item)?.choice ?? null;
  }

  function customChoice() {
    const chosen = setup.plaza.chosen.polish;
    if (state.custom.model) return `custom/${state.custom.model}`;
    return chosen.startsWith("custom/") ? chosen : null;
  }

  function usable(role, group, item) {
    if (group.kind === "local") return item.installed;
    if (group.kind === "custom") return hasKey("custom") && customChoice() !== null && customUrl() !== "";
    return hasKey(viaOf(role, group)) && offerOf(role, group, item) !== null;
  }

  const customUrl = () => state.custom.url || setup.plaza.chosen.customUrl;

  const isChosen = (role, group, item) => {
    const choice = choiceOf(role, group, item);
    return choice !== null && chosenOf(role) === choice;
  };
  /** 这个角色在正在用的识别方式里：转写在转写 + 润色、数据隐私两种里都算 */
  const isLive = (role) => ROLES[role].mode === setup.plaza.mode || (role === "transcribe" && privateNow());

  // ---------- 检测：同一套状态（未检测、检测中、通过、失败），模型、密钥两处共用（checks.mjs） ----------

  const checks = createChecks(() => draw());
  const statusControl = checks.control;
  const failNote = checks.note;

  /** 操作没成：失败说明挂在那一行下面，原因照主进程说的 */
  function failed(key, problem, title = "plaza.actionFailed") {
    checks.results[key] = { state: "fail", problem, title };
  }

  // ---------- 主进程那边的操作 ----------

  /** 发一件要等回话的事：同一时间只发一件，回来后重读状态 */
  async function act(key, call, { done } = {}) {
    if (state.busy) return;
    state.busy = key;
    delete checks.results[key];
    draw();
    let result;
    try {
      result = await call();
    } catch (error) {
      result = { ok: false, problem: describeError(error) };
    } finally {
      state.busy = null;
    }
    if (result?.ok === false) failed(key, result.problem);
    else done?.(result ?? {});
    await refresh();
    if (result?.note) toast(t.text(result.note));
  }

  /** 启用一个模型：在它那种识别方式里就只换模型，不在就连方式一起换 */
  function use(role, group, item, rowKey) {
    const choice = choiceOf(role, group, item);
    const mode = modeFor(role, group);
    const setting = mode === "private" ? "privateTranscriber" : ROLES[role].setting;
    const switching = setup.plaza.mode !== mode;
    const name = itemName(group, item);
    const customExtra = group.kind === "custom" ? { customUrl: customUrl() } : {};
    act(
      rowKey,
      () => {
        if (switching) {
          const changes = { [setting === "native" ? "model" : setting]: choice, ...customExtra };
          return window.speakmore.setMode(mode, changes);
        }
        if (role === "native") return window.speakmore.setModel(choice);
        if (role === "transcribe") return window.speakmore.setTranscriber(choice);
        return window.speakmore.setPolish(choice, customExtra.customUrl);
      },
      {
        done: () =>
          toast(
            switching
              ? t("plaza.toast.switchedWith", { mode: modeName(mode), model: name })
              : t("plaza.toast.enabled", { model: name }),
          ),
      },
    );
  }

  /** 检测一行：本机模型念一句交给它转，云端的按那一行的设置发一个最小的请求 */
  function checkCall(role, group, item) {
    if (group.kind === "local") return () => window.speakmore.checkTranscriber(item.choice);
    const choice = choiceOf(role, group, item);
    if (role === "native") return () => window.speakmore.checkModel("native", { model: choice });
    if (role === "transcribe") return () => window.speakmore.checkModel("local", { transcriber: choice });
    const extra = group.kind === "custom" ? { customUrl: customUrl() } : {};
    return () => window.speakmore.checkModel("local", { polish: choice, ...extra });
  }

  /** 检测一把 key：拿这个平台的默认模型走它能走的那条路 */
  function keyCheckCall(platform) {
    if (platform.id === "custom") {
      const choice = customChoice();
      return () => window.speakmore.checkModel("local", { polish: choice, customUrl: customUrl() });
    }
    if (platform.coverage.polish > 0) return () => window.speakmore.checkModel("local", { polish: platform.id });
    if (platform.coverage.native > 0) return () => window.speakmore.checkModel("native", { model: platform.id });
    return () => window.speakmore.checkModel("local", { transcriber: platform.id });
  }

  // ---------- 名字 ----------

  const viaText = (id) => (id === "local" ? t("plaza.via.local") : platformName(platformOf(id) ?? { id, name: id }));

  function itemName(group, item) {
    if (group.kind === "custom") return t("plaza.custom.name");
    return item.variant && group.kind === "local" ? `${item.name} · ${backendLabel(item)}` : item.name;
  }

  // ---------- 分类、筛选 ----------

  const shelfCount = (role) => setup.plaza.shelves[role].reduce((sum, group) => sum + group.items.length, 0);
  const keyCount = () => setup.plaza.platforms.filter(({ key }) => key).length;

  function renderTabs() {
    const icons = { native: "i-sparkles", transcribe: "i-audio-lines", polish: "i-wand-sparkles", keys: "i-key-round" };
    const counts = {
      native: String(shelfCount("native")),
      transcribe: String(shelfCount("transcribe")),
      polish: String(shelfCount("polish")),
      keys: `${keyCount()}/${setup.plaza.platforms.length}`,
    };
    $("plaza-tabs").replaceChildren(
      h("span", { class: "indicator", "aria-hidden": "true" }),
      ...TABS.map((id) =>
        h(
          "button",
          {
            type: "button",
            class: id === "keys" ? "tab end" : "tab",
            role: "tab",
            "aria-selected": String(state.tab === id),
            onclick: () => go(id),
          },
          svg(icons[id]),
          t(`plaza.tabs.${id}`),
          h("span", { class: "count", text: counts[id] }),
        ),
      ),
    );
  }

  function renderToolbar() {
    let lead = h("span");
    if (state.tab === "polish") {
      const groups = setup.plaza.shelves.polish.filter(({ kind }) => kind === "cloud");
      const pill = (id, text, icon, count) =>
        h(
          "button",
          {
            type: "button",
            class: "pill",
            "aria-pressed": String(state.maker === id),
            onclick: () => {
              state.maker = id;
              draw();
            },
          },
          icon,
          text,
          h("span", { class: "pill-count", text: String(count) }),
        );
      lead = h(
        "div",
        { class: "makers", role: "group", "aria-label": t("plaza.toolbar.makers") },
        pill("all", t("plaza.toolbar.all"), null, shelfCount("polish")),
        ...groups.map((group) => pill(group.id, makerName(group.id), brand(group.id), group.items.length)),
      );
    } else if (state.tab === "transcribe") {
      lead = h("p", { class: "toolbar-lead" }, h("i", { class: "best-dot" }), t("plaza.toolbar.best"));
    } else if (state.tab === "keys") {
      lead = h("p", { class: "toolbar-lead" }, svg("i-lock"), t("plaza.toolbar.keysLocal"));
    }
    const end =
      state.tab === "keys"
        ? h("span")
        : h(
            "div",
            { class: "toolbar-end" },
            state.tab !== "transcribe" && h("span", { class: "unit", text: t("plaza.toolbar.perMillion") }),
            h(
              "label",
              { class: "toggle" },
              t("plaza.toolbar.onlyUsable"),
              h("input", {
                type: "checkbox",
                class: "switch",
                checked: state.onlyUsable,
                onchange: (event) => {
                  state.onlyUsable = event.target.checked;
                  draw();
                },
              }),
            ),
          );
    $("plaza-toolbar").replaceChildren(lead, end);
    $("plaza-note").textContent =
      state.tab === "keys"
        ? t("plaza.notes.keys", { home: setup.home })
        : state.tab === "transcribe"
          ? t("plaza.notes.transcribe")
          : t("plaza.notes.prices");
  }

  /** 这一类不在正在用的识别方式里（数据隐私方式里的云端转写也算）：启用会连方式一起换，先说清楚 */
  function renderStandby() {
    const node = $("plaza-standby");
    const role = ROLES[state.tab];
    const cloudInPrivate = state.tab === "transcribe" && privateNow();
    node.hidden = !role || (isLive(state.tab) && !cloudInPrivate);
    if (node.hidden) return;
    const current = modeName(setup.plaza.mode);
    node.replaceChildren(
      svg("i-info"),
      h("span", {
        text: cloudInPrivate
          ? t("plaza.standby.privateCloud", { mode: modeName("local") })
          : t("plaza.standby.elsewhere", { current, mode: modeName(role.mode) }),
      }),
      h("button", { type: "button", class: "button ghost small", text: t("plaza.standby.pick"), onclick: pickMode }),
    );
  }

  /** 换到某一类，滚到分类标签那里；接着要滚到别处（展开的密钥表单）时不滚 */
  function go(tab, { scroll = true } = {}) {
    state.tab = TABS.includes(tab) ? tab : "native";
    state.returnTo = null;
    state.maker = "all";
    draw();
    if (!scroll) return;
    const content = document.querySelector(".content");
    content.scrollTo({ top: $("plaza-tabs").offsetTop - 72, behavior: "smooth" });
  }

  /** 刚展开的密钥表单：滚到眼前，光标放进第一个框（自定义服务是地址，别家是密钥） */
  function focusKeyForm(id) {
    const first = $(`plaza-key-${id}`)?.closest(".key-form")?.querySelector(".input");
    if (!first) return;
    first.scrollIntoView({ block: "center", behavior: "smooth" });
    first.focus({ preventScroll: true });
  }

  // ---------- 模型库 ----------

  /** 数据列：每组一套，同一页里同样的列上下对齐 */
  const PRICE_COLS = () => [
    { label: t("plaza.cols.input"), tip: t("plaza.cols.inputTip"), width: "4.5rem", field: "input" },
    { label: t("plaza.cols.output"), tip: t("plaza.cols.outputTip"), width: "4.5rem", field: "output" },
  ];
  const HOUR_COLS = () => [
    { label: t("plaza.cols.hour"), tip: t("plaza.cols.hourTip"), width: "4.5rem", field: "perHour" },
  ];
  // 数取自 bench/results/asr-round1-2026-10-16.md：97 条真实录音，Apple 芯片
  const SPEC_COLS = () => [
    { label: t("plaza.cols.zh"), tip: t("plaza.cols.zhTip"), width: "3.25rem", spec: "zh", better: "high", digits: 1 },
    {
      label: t("plaza.cols.mix"),
      tip: t("plaza.cols.mixTip"),
      width: "3.25rem",
      spec: "mix",
      better: "high",
      digits: 1,
    },
    {
      label: t("plaza.cols.minute"),
      tip: t("plaza.cols.minuteTip"),
      width: "3.5rem",
      spec: "minuteSeconds",
      better: "low",
      digits: 1,
      unit: t("plaza.units.seconds"),
    },
    {
      label: t("plaza.cols.memory"),
      tip: t("plaza.cols.memoryTip"),
      width: "3.5rem",
      spec: "memoryGB",
      better: "low",
      digits: 1,
      unit: "GB",
    },
    {
      label: t("plaza.cols.size"),
      tip: t("plaza.cols.sizeTip"),
      width: "3.5rem",
      spec: "sizeMB",
      better: "low",
      digits: 0,
      unit: "MB",
    },
  ];

  function colsOf(role, group) {
    if (group.kind === "local") return SPEC_COLS();
    if (group.kind === "custom") return [];
    return role === "transcribe" ? HOUR_COLS() : PRICE_COLS();
  }

  const backendLabel = (item) => t("plaza.build", { backend: t(`localModels.backends.${item.backend ?? "cpu"}`) });

  function tagNode(tag) {
    if (tag.kind === "issue") {
      return h("span", {
        class: "tag",
        "data-tone": "problem",
        title: t(`models.issues.${tag.issue}`),
        text: t("plaza.tags.issue"),
      });
    }
    // 未验证不加语气：灰底，只是如实交代，不算问题
    const tone = { default: "accent", tested: "ok", unverified: null }[tag.kind];
    return h("span", {
      class: "tag",
      "data-tone": tone,
      title: t(`plaza.tags.${tag.kind}Tip`),
      text: t(`plaza.tags.${tag.kind}`),
    });
  }

  /** 当前渠道上这一项没拿真 key 调过时，补一个未验证的标签（换个渠道可能就没有） */
  const unverifiedTag = (role, group, item) => (offerOf(role, group, item)?.unverified ? [{ kind: "unverified" }] : []);

  /** 名字那一格：图标、名字、标签；有说明时在下一行 */
  function nameCell({ icon, tile, name, build, tags = [], desc, extra }) {
    return h(
      "div",
      { class: "cell-name", role: "cell" },
      tile ? logoTile(tile) : icon,
      h(
        "div",
        { class: "name-stack" },
        h(
          "div",
          { class: "name-line" },
          h("span", { class: "name", text: name }),
          (build || tags.length > 0 || extra) && h("span", { class: "name-tags" }, build, tags.map(tagNode), extra),
        ),
        desc && h("p", { class: "desc" }, desc),
      ),
    );
  }

  function metricCell(col, role, group, item) {
    if (col.spec) {
      const values = group.items.map((it) => it.specs?.[col.spec]).filter((value) => typeof value === "number");
      const value = item.specs?.[col.spec];
      if (typeof value !== "number")
        return h("span", { class: "cell-end metric-none", role: "cell", "data-label": col.label, text: "—" });
      const best = col.better === "high" ? Math.max(...values) : Math.min(...values);
      return h(
        "span",
        {
          class: "cell-end metric",
          role: "cell",
          "data-best": value === best,
          "data-label": col.label,
          title: col.tip,
        },
        h(
          "span",
          { class: "metric-line" },
          h("span", { class: "metric-value", text: value.toFixed(col.digits) }),
          col.unit && h("span", { class: "metric-unit", text: col.unit }),
        ),
      );
    }
    const price = offerOf(role, group, item)?.price;
    if (!price || typeof price[col.field] !== "number") {
      return h("span", {
        class: "cell-end metric-none",
        role: "cell",
        "data-label": col.label,
        title: t("plaza.cols.noPrice"),
        text: "—",
      });
    }
    return h(
      "span",
      {
        class: "cell-end metric",
        role: "cell",
        "data-label": col.label,
        title: price.approx ? t("plaza.cols.hourApprox") : col.tip,
      },
      h(
        "span",
        { class: "metric-line" },
        h("span", { class: "metric-cur", text: `${price.approx ? "≈" : ""}${money(price.currency)}` }),
        h("span", { class: "metric-value", text: amount(price[col.field]).toFixed(decimalsOf(col, role, group)) }),
      ),
    );
  }

  /** 同一列的小数位一致（界面规范第 1 节）：这一组在看的渠道上、这一列的价里最多几位（最多两位），都写成这么多位 */
  function decimalsOf(col, role, group) {
    let most = 0;
    for (const it of group.items) {
      const value = offerOf(role, group, it)?.price?.[col.field];
      if (typeof value !== "number") continue;
      const [, fraction = ""] = String(amount(value)).split(".");
      most = Math.max(most, fraction.length);
    }
    return most;
  }

  const rowKey = (role, group, item) => `${role}:${group.id}:${item.choice ?? item.name ?? "custom"}`;

  function statusFor(role, group, item) {
    const key = rowKey(role, group, item);
    if (group.kind === "local" && item.download) return progressBadge(item.download);
    if (!usable(role, group, item)) return h("span", { "aria-hidden": "true" });
    const tip = group.kind === "local" ? t("plaza.check.localTip") : t("plaza.check.modelTip");
    return statusControl(key, tip, checkCall(role, group, item));
  }

  function actionFor(role, group, item) {
    const key = rowKey(role, group, item);
    const busy = state.busy === key;
    if (isChosen(role, group, item)) {
      return isLive(role)
        ? h("span", { class: "state-box block", "data-tone": "accent" }, svg("i-check"), t("plaza.inUse"))
        : h(
            "span",
            {
              class: "state-box block",
              "data-tone": "standby",
              title: t("plaza.chosenTip", { mode: modeName(ROLES[role].mode) }),
            },
            t("plaza.chosen"),
          );
    }
    if (group.kind === "local" && !item.installed) {
      return item.download
        ? h("button", {
            type: "button",
            class: "button ghost block",
            text: t("plaza.actions.cancel"),
            onclick: () =>
              act(key, () => window.speakmore.cancelDownload(item.choice), {
                done: () => toast(t("plaza.toast.canceled")),
              }),
          })
        : h(
            "button",
            {
              type: "button",
              class: "button block",
              disabled: busy,
              onclick: () => act(key, () => window.speakmore.downloadModel(item.choice)),
            },
            svg("i-download"),
            t("plaza.actions.download"),
          );
    }
    if (!usable(role, group, item) || !setup.switchable) {
      return h("button", {
        type: "button",
        class: "button block",
        disabled: true,
        title: t("plaza.actions.needKey"),
        text: t("plaza.actions.use"),
      });
    }
    return h("button", {
      type: "button",
      class: "button block",
      disabled: busy,
      text: t("plaza.actions.use"),
      onclick: () => use(role, group, item, key),
    });
  }

  /** 渠道：同一模型多个平台都卖时的分段控件；勾是该平台已配置密钥 */
  function channelControl(role, group) {
    if (group.kind !== "cloud") return null;
    const via = viaOf(role, group);
    const single = group.channels.length === 1;
    const nameOf = (id) => {
      const official = OFFICIAL[id] === group.id;
      const platform = platformName(platformOf(id) ?? { id, name: id });
      if (!official) return platform;
      return single ? t("plaza.channel.officialOf", { platform }) : t("plaza.channel.official");
    };
    const labelId = `channel-${role}-${group.id}`;
    return h(
      "div",
      { class: "channel" },
      h("span", { class: "channel-label", id: labelId, text: t("plaza.channel.label") }),
      h(
        "div",
        {
          class: "segmented",
          role: "radiogroup",
          "aria-labelledby": labelId,
          "data-indicator": `seg-${role}-${group.id}`,
          "data-single": single,
        },
        h("span", { class: "indicator", "aria-hidden": "true" }),
        ...group.channels.map((id) =>
          h(
            "button",
            {
              type: "button",
              class: "segment",
              role: "radio",
              "aria-checked": String(via === id),
              "aria-disabled": single ? "true" : null,
              title: `${platformName(platformOf(id) ?? { id, name: id })} · ${t(hasKey(id) ? "plaza.channel.keyed" : "plaza.channel.noKey")}`,
              onclick: single
                ? null
                : () => {
                    state.via[group.id] = id;
                    draw();
                  },
            },
            brand(id),
            nameOf(id),
            hasKey(id) && svg("i-check", "icon key-mark"),
          ),
        ),
      ),
    );
  }

  /** 组内渠道没有密钥：表头下面一行说明，按钮落在操作列 */
  function keyNotice(role, group) {
    if (group.kind === "local") return null;
    const via = group.kind === "custom" ? "custom" : viaOf(role, group);
    if (hasKey(via) && (group.kind !== "custom" || usable(role, group, group.items[0]))) return null;
    const platform = platformOf(via);
    const custom = via === "custom";
    return h(
      "div",
      { class: "row row-notice", role: "row" },
      h(
        "p",
        { class: "notice-text", role: "cell" },
        svg("i-key-round"),
        h(
          "span",
          {},
          h("b", { text: platformName(platform) }),
          ` · ${t(custom ? "plaza.notice.custom" : "plaza.notice.noKey")}`,
        ),
      ),
      h(
        "div",
        { class: "cell-fill", role: "cell" },
        h("button", {
          type: "button",
          class: "button block",
          text: t(custom ? "plaza.actions.configure" : "plaza.actions.configureKey"),
          onclick: () => {
            state.openKey = via;
            const from = state.tab;
            go("keys", { scroll: false });
            state.returnTo = from;
            focusKeyForm(via);
          },
        }),
      ),
    );
  }

  function table(cols, first, rows, { dense = false } = {}) {
    const head = h(
      "div",
      { class: "row row-head", role: "row" },
      h("span", { role: "columnheader", text: first }),
      h(
        "span",
        { class: "metrics" },
        cols.map((col) =>
          h("span", { class: col.start ? null : "cell-end", role: "columnheader", title: col.tip, text: col.label }),
        ),
      ),
      h("span", { class: "head-status", role: "columnheader", text: t("plaza.cols.status") }),
      h("span", { role: "columnheader" }, h("span", { class: "visually-hidden", text: t("plaza.cols.action") })),
    );
    return h(
      "div",
      {
        class: "table",
        role: "table",
        "data-dense": dense,
        style: cols.length ? `--metric-cols: ${cols.map((c) => c.width).join(" ")}` : null,
      },
      head,
      rows,
    );
  }

  function modelRow(role, group, item) {
    const key = rowKey(role, group, item);
    const local = group.kind === "local";
    const removable = local && item.installed && !isChosen(role, group, item) && !item.download;
    const remove =
      removable &&
      h(
        "button",
        {
          type: "button",
          class: "icon-button remove",
          title: t("plaza.actions.remove"),
          "aria-label": t("plaza.actions.removeModel", { model: itemName(group, item) }),
          onclick: () =>
            act(key, () => window.speakmore.deleteModel(item.choice), {
              done: () => toast(t("plaza.toast.removed", { model: itemName(group, item) })),
            }),
        },
        svg("i-trash"),
      );
    const fields = local
      ? {
          icon: brand(item.maker),
          name: item.name,
          build:
            item.backend &&
            h("span", {
              class: "tag",
              "data-tone": "outline",
              title: t("plaza.buildTip", { variant: item.variant }),
              text: backendLabel(item),
            }),
          tags: item.tags,
          extra: remove,
        }
      : group.kind === "custom"
        ? { icon: brand("custom"), name: t("plaza.custom.name"), desc: customDesc() }
        : { icon: brand(group.id), name: item.name, tags: [...item.tags, ...unverifiedTag(role, group, item)] };
    return h(
      "div",
      { class: "row", role: "row", "data-current": isChosen(role, group, item) },
      nameCell(fields),
      h(
        "span",
        { class: "metrics" },
        colsOf(role, group).map((col) => metricCell(col, role, group, item)),
      ),
      h("div", { class: "cell-fill cell-status", role: "cell" }, statusFor(role, group, item)),
      h("div", { class: "cell-fill", role: "cell" }, actionFor(role, group, item)),
      failNote(key),
      local &&
        item.problem &&
        h("p", { class: "callout", role: "alert" }, svg("i-circle-alert"), h("span", {}, t.text(item.problem))),
    );
  }

  function customDesc() {
    const choice = customChoice();
    if (choice && customUrl()) return `${choice.slice("custom/".length)} · ${hostOf(customUrl())}`;
    return t("plaza.custom.desc");
  }

  /** 地址的主机名。填的地址还没验证、可能写错（漏了 https://）：认不出就照填的写，不让整页画不出来 */
  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  function groupHead(role, group, count) {
    const local = group.kind === "local";
    const custom = group.kind === "custom";
    let meta = null;
    if (local) {
      const done = group.items.filter(({ installed }) => installed).length;
      meta = t(group.freeBytes === null ? "plaza.groups.localMeta" : "plaza.groups.localMetaFree", {
        done: String(done),
        total: String(group.items.length),
        free: group.freeBytes === null ? "" : `${Math.round(group.freeBytes / 1e9)} GB`,
      });
    } else if (role === "transcribe" && !custom) {
      meta = t("plaza.facts.upload", { platform: viaText(viaOf(role, group)) });
    } else if (custom) {
      meta = t("plaza.custom.meta");
    }
    const icon = local ? svg("i-laptop") : brand(custom ? "custom" : group.id);
    const name = local ? t("plaza.groups.local") : custom ? t("plaza.groups.custom") : makerName(group.id);
    return h(
      "header",
      { class: "group-head" },
      logoTile(icon),
      h(
        "div",
        { class: "group-titles" },
        h(
          "div",
          { class: "group-title-line" },
          h("h3", { class: "group-name", text: name }),
          h("span", { class: "group-count", text: String(count) }),
        ),
        meta && h("p", { class: "group-meta", text: meta }),
      ),
      channelControl(role, group),
    );
  }

  function matches(group, item, query) {
    if (!query) return true;
    const text = `${item.name ?? t("plaza.custom.name")} ${item.choice ?? ""} ${Object.values(item.offers ?? {})
      .map(({ choice }) => choice)
      .join(" ")} ${makerName(group.id)}`;
    return text.toLowerCase().includes(query);
  }

  function renderGroups() {
    const root = $("plaza-groups");
    if (state.tab === "keys") return renderKeys(root);
    const role = state.tab;
    const query = state.query.trim().toLowerCase();
    const sections = setup.plaza.shelves[role]
      .filter((group) => role !== "polish" || state.maker === "all" || state.maker === group.id)
      .map((group) => {
        const items = group.items.filter(
          (item) => (!state.onlyUsable || usable(role, group, item)) && matches(group, item, query),
        );
        if (items.length === 0) return null;
        return h(
          "section",
          { class: "group", "aria-label": group.kind === "local" ? t("plaza.groups.local") : makerName(group.id) },
          groupHead(role, group, items.length),
          table(
            colsOf(role, group),
            t("plaza.cols.model"),
            [keyNotice(role, group), ...items.map((item) => modelRow(role, group, item))],
            {
              dense: group.kind === "local",
            },
          ),
        );
      })
      .filter(Boolean);
    if (sections.length > 0) {
      root.replaceChildren(...sections);
      return;
    }
    const filters = [
      query && t("plaza.empty.search", { query: state.query.trim() }),
      state.onlyUsable && t("plaza.toolbar.onlyUsable"),
    ]
      .filter(Boolean)
      .join(" · ");
    root.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("p", { class: "empty-title", text: t("plaza.empty.title") }),
        h("p", { class: "empty-meta", text: filters }),
        h("button", { type: "button", class: "button", text: t("plaza.empty.clear"), onclick: clearFilters }),
      ),
    );
  }

  function clearFilters() {
    state.query = "";
    state.onlyUsable = false;
    state.maker = "all";
    $("plaza-search").value = "";
    draw();
  }

  // ---------- 密钥 ----------

  function coverage(platform) {
    if (platform.id === "custom") return t("plaza.custom.desc");
    const parts = ["native", "transcribe", "polish"]
      .filter((role) => platform.coverage[role] > 0)
      .map((role) => [t(`plaza.tabs.${role}`), platform.coverage[role]]);
    return [
      `${t("plaza.keys.coverage")} `,
      ...parts.flatMap(([text, count], index) => [index > 0 ? " · " : "", `${text} `, h("b", { text: String(count) })]),
    ];
  }

  function keyValue(platform) {
    if (platform.key === "env") return t("plaza.keys.env");
    if (platform.key === "stored") return t("plaza.keys.stored");
    return t("plaza.keys.none");
  }

  /** 存了这把 key 之后能用的模型有几个（三排货架上这个平台卖的） */
  const newlyUsable = (platform) => Object.values(platform.coverage).reduce((sum, count) => sum + count, 0);

  function keyForm(platform) {
    const custom = platform.id === "custom";
    const name = platformName(platform);
    const key = `key:${platform.id}`;
    const field = (id, props) => h("input", { class: "input", id, autocomplete: "off", spellcheck: "false", ...props });
    return h(
      "form",
      {
        class: "key-form",
        // 地址写得不对由主进程按界面语言说（挂在这一行下面），不用浏览器自带的气泡：它跟着系统语言、样子也不一样
        novalidate: true,
        onsubmit: (event) => {
          event.preventDefault();
          const value = $(`plaza-key-${platform.id}`).value.trim();
          if (custom) {
            state.custom = { url: $("plaza-custom-url").value.trim(), model: $("plaza-custom-model").value.trim() };
          }
          const changes =
            custom && state.custom.model
              ? { polish: `custom/${state.custom.model}`, customUrl: state.custom.url }
              : undefined;
          act(key, () => window.speakmore.saveKey(value, platform.id, changes), {
            done: () => {
              state.openKey = null;
              delete checks.results[key];
              const count = newlyUsable(platform);
              toast(count > 0 ? t("plaza.toast.keySaved", { count }) : t("plaza.toast.keySavedOnly"));
              if (state.returnTo) go(state.returnTo);
            },
          });
        },
      },
      custom &&
        field("plaza-custom-url", {
          type: "url",
          value: customUrl(),
          placeholder: t("plaza.custom.urlPlaceholder"),
          "aria-label": t("plaza.custom.url"),
        }),
      custom &&
        field("plaza-custom-model", {
          value: customChoice()?.slice("custom/".length) ?? "",
          placeholder: t("plaza.custom.modelPlaceholder"),
          "aria-label": t("plaza.custom.model"),
        }),
      field(`plaza-key-${platform.id}`, {
        type: "password",
        class: "input key-input",
        placeholder: t("plaza.keys.placeholder", { platform: name }),
        "aria-label": t("plaza.keys.label", { platform: name }),
      }),
      h("button", {
        type: "submit",
        class: "button primary",
        disabled: state.busy === key,
        text: t("plaza.keys.save"),
      }),
      h("button", {
        type: "button",
        class: "button ghost",
        text: t("plaza.keys.cancel"),
        onclick: () => {
          state.openKey = null;
          draw();
        },
      }),
      platform.key === "stored" &&
        h("button", {
          type: "button",
          class: "button ghost",
          text: t("plaza.keys.remove"),
          onclick: () =>
            act(key, () => window.speakmore.forgetKey(platform.id), {
              done: () => {
                state.openKey = null;
                toast(t("plaza.toast.keyRemoved", { platform: name }));
              },
            }),
        }),
      platform.hasKeyPage &&
        h(
          "button",
          { type: "button", class: "key-link", onclick: () => window.speakmore.openKeyPage(platform.id) },
          t("plaza.keys.get"),
          svg("i-external-link"),
        ),
    );
  }

  function renderKeys(root) {
    const cols = [{ label: t("plaza.cols.key"), width: "8.5rem", start: true }];
    const rows = setup.plaza.platforms.map((platform) => {
      const filled = Boolean(platform.key);
      const open = state.openKey === platform.id;
      const key = `key:${platform.id}`;
      const checkable = filled && (platform.id !== "custom" || (customChoice() && customUrl()));
      return h(
        "div",
        { class: "row", role: "row", "data-open": open },
        nameCell({
          tile: brand(platform.id),
          name: platformName(platform),
          tags: [],
          desc: coverage(platform),
          extra:
            platform.id === "bailian" &&
            h("span", { class: "tag", "data-tone": "accent", text: t("plaza.keys.widest") }),
        }),
        h(
          "span",
          { class: "metrics" },
          h("span", {
            class: "key-value",
            role: "cell",
            "data-empty": !filled,
            title: platform.key === "env" ? t("plaza.keys.envTip", { variable: platform.keyEnv }) : null,
            text: keyValue(platform),
          }),
        ),
        h(
          "div",
          { class: "cell-fill cell-status", role: "cell" },
          checkable
            ? statusControl(key, t("plaza.check.keyTip"), keyCheckCall(platform))
            : h("span", { "aria-hidden": "true" }),
        ),
        h(
          "div",
          { class: "cell-fill", role: "cell" },
          h("button", {
            type: "button",
            class: open ? "button ghost block" : "button block",
            disabled: !setup.switchable,
            text: t(open ? "plaza.keys.collapse" : filled ? "plaza.keys.replace" : "plaza.actions.configure"),
            onclick: () => {
              state.openKey = open ? null : platform.id;
              draw();
              if (!open) focusKeyForm(platform.id);
            },
          }),
        ),
        failNote(key),
        open && keyForm(platform),
      );
    });
    root.replaceChildren(
      h("section", { class: "group", "aria-label": t("plaza.tabs.keys") }, table(cols, t("plaza.cols.platform"), rows)),
    );
  }

  const indicators = slidingIndicators(document.querySelector('.page[data-route="models"]'));

  // ---------- 总的 ----------

  /** 重画时正在填的输入框不能丢：记下它的值、光标，画完放回去 */
  function keepingInput(paint) {
    const active = document.activeElement;
    const kept = active?.id?.startsWith("plaza-") && active.tagName === "INPUT" ? active : null;
    const values = [...document.querySelectorAll(".key-form .input")].map((input) => [input.id, input.value]);
    paint();
    for (const [id, value] of values) {
      const input = $(id);
      if (input) input.value = value;
    }
    if (kept && kept.id !== "plaza-search") {
      const input = $(kept.id);
      input?.focus({ preventScroll: true });
      if (input && kept.selectionStart !== null) input.setSelectionRange(kept.selectionStart, kept.selectionEnd);
    }
  }

  function draw() {
    if (!setup?.plaza) return;
    keepingInput(() => {
      renderTabs();
      renderToolbar();
      renderStandby();
      renderGroups();
    });
    indicators.place();
  }

  $("plaza-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderGroups();
    indicators.place();
  });

  return {
    /** @param {object} next getSetup 给的整份状态 */
    render(next) {
      setup = next;
      draw();
    },

    /** 打开到某一类（"keys" 是密钥表），可以顺带展开某个平台的密钥表单 */
    show({ tab, platform } = {}) {
      if (tab) state.tab = TABS.includes(tab) ? tab : state.tab;
      if (platform) state.openKey = platform;
      draw();
      // 从别处（首页的识别方式、横幅）来填某一家的 key
      if (platform) focusKeyForm(platform);
    },

    /** 页面切到前台时，分类的下划线要按真实宽度重新放 */
    shown() {
      indicators.reset();
      indicators.place();
    },
  };
}
