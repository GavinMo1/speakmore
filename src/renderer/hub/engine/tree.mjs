import { brand, h, svg } from "../../shared/dom.mjs";
import { t } from "../../shared/i18n.mjs";
import { needText } from "../route-view.mjs";
import { DOCK_ANCHOR, offsetIn } from "./canvas.mjs";
import {
  backendLabel,
  itemKey,
  itemName,
  MODE_ORDER,
  MODE_ROLES,
  makerName,
  modeName,
  ROLE_IDS,
  ROLES,
  roleName,
} from "./plaza-view.mjs";

// 引擎页的树：识别方式 → 环节（原生、转写、润色）→ 厂商 → 型号，从左往右展开。一级只放名字和一个状态，
// 价格、规格、渠道、检测、启用都在点开的详情里（detail.mjs）。线从父节点右边连到子节点左边：
// 正在用的那一路是主题色、线上一小段光往右走；已选定、所在方式没在用的是虚线；其余是淡线。

/** 线上那段光走一圈多久，和 engine.css 的 .flow 一致：重画时接着原来的位置走，不从头跳 */
const FLOW_MS = 2600;

/** 一条线：从 (x1, y1) 到 (x2, y2) 的三次曲线，两头都是水平的，分叉自然往右上、右、右下走 */
export function curve(x1, y1, x2, y2) {
  const dx = Math.max(16, (x2 - x1) * 0.5);
  const n = (value) => value.toFixed(1);
  return `M${n(x1)},${n(y1)} C${n(x1 + dx)},${n(y1)} ${n(x2 - dx)},${n(y2)} ${n(x2)},${n(y2)}`;
}

/** 节点下面那一行：一个小圆点或小图标，加几个字 */
function line(kind, text, title) {
  const glyph = {
    live: h("i", { class: "dot", "data-tone": "live" }),
    standby: h("i", { class: "dot", "data-tone": "standby" }),
    key: svg("i-key-round"),
    url: svg("i-key-round"),
    download: svg("i-download"),
    local: svg("i-shield-check"),
    problem: svg("i-circle-alert"),
    busy: svg("i-loader-circle", "icon spin"),
  }[kind];
  return h(
    "span",
    { class: "node-line", "data-kind": kind, title },
    glyph,
    h("span", { class: "node-line-text", text }),
  );
}

/** 一个标签：出厂默认、已评测、已知问题（悬停说是什么问题）、未验证 */
export function tagNode(tag) {
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

/** 名字后面的标签：本机模型的做法，出厂默认、已评测、已知问题，看的渠道上没调过的再加未验证 */
export function badges(view, role, group, item) {
  return [
    group.kind === "local" &&
      item.backend &&
      h("span", {
        class: "tag",
        "data-tone": "outline",
        title: t("plaza.buildTip", { variant: item.variant }),
        text: backendLabel(item),
      }),
    ...item.tags.map(tagNode),
    view.offerOf(role, group, item)?.unverified && tagNode({ kind: "unverified" }),
  ].filter(Boolean);
}

/**
 * @param {object} ctx 引擎页（page.mjs）：setup、view、ui 和那几个操作
 * @param {object} els 树的几列、两层连线、停详情的那一格
 */
export function createTree(ctx, els) {
  const { ui } = ctx;

  // ---------- 识别方式：第一列，三选一，点一个当场换上 ----------

  function modeNode(mode) {
    const { setup } = ctx;
    const { plaza } = setup;
    const way = plaza.ways[mode];
    const current = plaza.mode === mode;
    const busy = ui.modeBusy === mode;
    const platformOf = (id) => ctx.view.platformOf(id) ?? { id, name: id };
    const downloadOf = (id) => setup.local.transcribers.find((model) => model.id === id)?.download ?? null;
    const needs = way.problem
      ? [{ kind: "problem", text: t.text(way.problem) }]
      : way.needs.map((need) => ({ kind: need.kind, text: needText(need, { ...way, platformOf, downloadOf }) }));
    // 没在用、也不缺什么的方式只写名字，说明在悬停里
    let status = null;
    if (busy) status = line("busy", t("home.mode.switching"));
    else if (ui.modeFailure?.mode === mode) {
      const text = `${t("home.mode.failed")} · ${t.text(ui.modeFailure.problem)}`;
      status = line("problem", text, text);
    } else if (current) {
      status = line("live", [t("plaza.inUse"), ...needs.slice(0, 1).map(({ text }) => text)].join(" · "));
    } else if (needs.length > 0) status = line(needs[0].kind, needs[0].text, needs.map(({ text }) => text).join(" · "));
    return h(
      "button",
      {
        type: "button",
        class: "mode-node",
        role: "radio",
        "aria-checked": String(current),
        "aria-busy": busy ? "true" : null,
        "data-key": mode,
        "data-warn": needs.length > 0 ? "" : null,
        // 正在换的那一种不置灰（它在转圈）；别的事在等回话时也不让换
        disabled: !setup.switchable || (ctx.waiting() && !busy),
        title: setup.switchable ? `${modeName(mode)} · ${t(`home.mode.desc.${mode}`)}` : t("home.mode.locked"),
        onclick: () => ctx.switchMode(mode),
        onmouseenter: () => hoverMode(mode),
        onmouseleave: () => hoverMode(null),
        onfocus: () => hoverMode(mode),
        onblur: () => hoverMode(null),
      },
      h("span", { class: "radio-mark", "aria-hidden": "true" }, svg("i-check")),
      h("span", { class: "node-text" }, h("span", { class: "node-name", text: modeName(mode) }), status),
    );
  }

  /** 光标停在一种方式上：它经过的那几条线先亮起来 */
  function hoverMode(mode) {
    if (ui.hoverMode === mode) return;
    ui.hoverMode = mode;
    drawLinks();
  }

  // ---------- 环节、厂商 ----------

  /** 一个节点：厂商前面是品牌标志的方形底座，环节只有字（不给说明性的图标垫底座，见界面规范第 3 节） */
  function node({ level, key, icon = null, name, count, status, tone, open, dim, title, onclick }) {
    return h(
      "button",
      {
        type: "button",
        class: "node",
        "data-level": level,
        "data-key": key,
        "data-tone": tone,
        "data-dim": dim ? "" : null,
        "aria-expanded": String(open),
        title,
        onclick,
      },
      icon && h("span", { class: "logo-tile", "data-dim": dim ? "" : null }, icon),
      h(
        "span",
        { class: "node-text" },
        h(
          "span",
          { class: "node-name-line" },
          h("span", { class: "node-name", text: name }),
          h("span", { class: "node-count", text: String(count) }),
        ),
        status,
      ),
    );
  }

  function roleNode(role) {
    const { view, setup } = ctx;
    const spot = view.chosenSpot(role);
    const live = view.isLive(role);
    const chosen = spot ? itemName(spot.group, spot.item) : t("plaza.unchosen");
    const where = live ? t("plaza.inUse") : t("plaza.chosenTip", { mode: modeName(ROLES[role].mode) });
    return node({
      level: "role",
      key: role,
      name: roleName(role),
      count: setup.plaza.shelves[role].reduce((sum, group) => sum + group.items.length, 0),
      status: line(spot ? (live ? "live" : "standby") : "plain", chosen),
      tone: spot ? (live ? "live" : "standby") : null,
      open: ui.role === role,
      title: [
        roleName(role),
        t(`plaza.roleDesc.${role}`),
        spot && `${where} · ${itemName(spot.group, spot.item, { withBuild: true })}`,
      ]
        .filter(Boolean)
        .join(" · "),
      onclick: () => ctx.pickRole(role),
    });
  }

  function makerNode(role, group) {
    const { view } = ctx;
    const kind = view.groupLine(role, group);
    const block = view.groupBlocker(group);
    let status = null;
    if (kind === "live") status = line("live", t("plaza.inUse"));
    else if (kind === "standby") status = line("standby", t("plaza.chosen"));
    else if (block === "key") status = line("key", t("plaza.notice.noKey"));
    else if (block === "custom") status = line("key", t("plaza.notice.custom"));
    else if (group.kind === "local") {
      const done = group.items.filter(({ installed }) => installed).length;
      status = line("local", t("plaza.state.downloaded", { done, total: group.items.length }));
    }
    return node({
      level: "maker",
      key: group.id,
      icon: group.kind === "local" ? svg("i-laptop") : brand(group.kind === "custom" ? "custom" : group.id),
      name: makerName(group),
      count: group.items.length,
      status,
      tone: kind === "base" ? null : kind,
      open: ui.maker === group.id,
      dim: block !== null,
      title: makerName(group),
      onclick: () => ctx.pickMaker(group.id),
    });
  }

  // ---------- 型号：树叶 ----------

  /** 只放一个小图标的状态：悬停看 title，读屏读藏起来的那一句（图标本身对读屏是藏着的） */
  function iconMark(text, ...glyph) {
    return h("span", { class: "leaf-icon", title: text }, ...glyph, h("span", { class: "visually-hidden", text }));
  }

  /** 型号右边：正在用、已选定写成带点的字；没下载、下载中、缺密钥、出了问题只放一个小图标 */
  function leafMark(role, group, item) {
    const { view } = ctx;
    const kind = view.lineOf(role, group, item);
    if (kind === "live") {
      return h(
        "span",
        { class: "leaf-state", "data-tone": "live" },
        h("i", { class: "dot", "data-tone": "live" }),
        t("plaza.inUse"),
      );
    }
    if (kind === "standby") {
      return h(
        "span",
        { class: "leaf-state", title: t("plaza.chosenTip", { mode: modeName(ROLES[role].mode) }) },
        h("i", { class: "dot", "data-tone": "standby" }),
        t("plaza.chosen"),
      );
    }
    if (group.kind === "local" && item.problem) {
      const mark = iconMark(t.text(item.problem), svg("i-circle-alert"));
      mark.dataset.tone = "problem";
      return mark;
    }
    const block = view.blocker(role, group, item);
    if (block === "downloading") {
      const { received, total } = item.download;
      const percent = Math.floor((received / (total || 1)) * 100);
      return iconMark(
        t("plaza.state.downloading"),
        svg("i-loader-circle", "icon spin"),
        h("span", { class: "leaf-percent", text: `${percent}%` }),
      );
    }
    if (block === "download") return iconMark(t("plaza.state.notDownloaded"), svg("i-download"));
    if (block === "key" || block === "custom") {
      return iconMark(t(block === "custom" ? "plaza.notice.custom" : "plaza.notice.noKey"), svg("i-key-round"));
    }
    return null;
  }

  function leaf(role, group, item) {
    const { view } = ctx;
    const key = itemKey(item);
    const kind = view.lineOf(role, group, item);
    const block = view.blocker(role, group, item);
    const open = ui.detail && ui.item === key;
    const tags = badges(view, role, group, item);
    return h(
      "button",
      {
        type: "button",
        class: "leaf",
        "data-key": key,
        "data-tone": kind === "base" ? null : kind,
        "data-dim": block === "key" || block === "custom" ? "" : null,
        "aria-expanded": String(open),
        title: itemName(group, item, { withBuild: true }),
        onclick: (event) => ctx.pickItem(key, event),
      },
      h(
        "span",
        { class: "leaf-text" },
        h("span", { class: "leaf-name", text: itemName(group, item) }),
        tags.length > 0 ? h("span", { class: "leaf-tags" }, tags) : null,
      ),
      leafMark(role, group, item),
    );
  }

  // ---------- 画 ----------

  function render() {
    const { plaza } = ctx.setup;
    els.modes.replaceChildren(...MODE_ORDER.map(modeNode));
    els.roles.replaceChildren(...ROLE_IDS.map(roleNode));
    const groups = ui.role ? plaza.shelves[ui.role] : [];
    els.makers.replaceChildren(...groups.map((group) => makerNode(ui.role, group)));
    const group = groups.find(({ id }) => id === ui.maker);
    els.models.replaceChildren(...(group ? group.items.map((item) => leaf(ui.role, group, item)) : []));
  }

  /** 一列里 data-key 是 key 的那个节点 */
  const find = (column, key) => [...column.children].find((el) => el.dataset.key === key) ?? null;

  /** 现在每一对该连的：从哪个节点到哪个节点，哪种线，是不是展开着的那一条 */
  function pairs() {
    const { view, setup } = ctx;
    const found = [];
    for (const modeEl of els.modes.children) {
      const mode = modeEl.dataset.key;
      for (const role of MODE_ROLES[mode]) {
        found.push({
          from: modeEl,
          to: find(els.roles, role),
          kind: mode === setup.plaza.mode ? "live" : "base",
          open: ui.hoverMode === mode,
        });
      }
    }
    if (!ui.role) return found;
    const groups = setup.plaza.shelves[ui.role];
    const roleEl = find(els.roles, ui.role);
    // 重画到一半（换了环节、厂商那一列还没换）时也会来问：对不上的那几个先不连，画完会再连一次
    for (const el of els.makers.children) {
      const group = groups.find(({ id }) => id === el.dataset.key);
      if (!group) continue;
      found.push({ from: roleEl, to: el, kind: view.groupLine(ui.role, group), open: ui.maker === group.id });
    }
    const group = groups.find(({ id }) => id === ui.maker);
    const makerEl = find(els.makers, ui.maker);
    for (const el of group ? els.models.children : []) {
      const item = group.items.find((it) => itemKey(it) === el.dataset.key);
      if (!item) continue;
      found.push({
        from: makerEl,
        to: el,
        kind: view.lineOf(ui.role, group, item),
        open: ui.detail && ui.item === el.dataset.key,
      });
    }
    return found;
  }

  /** 树里的线：画在 world 里、跟着一起缩放（线宽不缩）；按排版的位置算，不受过渡影响 */
  function drawTreeLinks() {
    const tree = els.tree;
    const svgEl = els.links;
    const w = tree.offsetWidth;
    const hgt = tree.offsetHeight;
    svgEl.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
    svgEl.setAttribute("width", String(w));
    svgEl.setAttribute("height", String(hgt));
    const order = { base: 0, standby: 1, live: 2 };
    const weight = ({ kind, open }) => order[kind] + (open ? 0.5 : 0);
    // 亮的压在淡的上面
    const sorted = pairs()
      .filter(({ from, to }) => from && to)
      .sort((a, b) => weight(a) - weight(b));
    const paths = sorted.map(({ from, to, kind, open }) => {
      const a = offsetIn(from, tree);
      const b = offsetIn(to, tree);
      const d = curve(a.right, a.top + a.height / 2, b.left, b.top + b.height / 2);
      const path = `<path class="link ${kind}${open ? " open" : ""}" vector-effect="non-scaling-stroke" d="${d}"/>`;
      return kind === "live" ? `${path}<path class="flow" vector-effect="non-scaling-stroke" d="${d}"/>` : path;
    });
    svgEl.innerHTML = paths.join("");
    // 相位走 CSSOM：写在 innerHTML 的 style 属性里会被页面的 CSP 拦掉
    const delay = `-${Math.round(performance.now() % FLOW_MS)}ms`;
    for (const flow of svgEl.querySelectorAll(".flow")) flow.style.animationDelay = delay;
  }

  /** 点开的那一项连到右边停着的详情：画在画布这一层、不缩放，按屏幕上的位置算（过渡时每一帧跟着） */
  function drawDockLink() {
    const svgEl = els.canvasLinks;
    const canvas = els.canvas;
    svgEl.setAttribute("viewBox", `0 0 ${canvas.clientWidth} ${canvas.clientHeight}`);
    const card = els.dock.firstElementChild;
    const leafEl = ui.detail ? find(els.models, ui.item) : null;
    if (!card || !leafEl) {
      svgEl.replaceChildren();
      return;
    }
    const box = canvas.getBoundingClientRect();
    const a = leafEl.getBoundingClientRect();
    const b = card.getBoundingClientRect();
    const x1 = a.right - box.left;
    const x2 = b.left - box.left;
    // 那一项被拖到详情底下去了：不画
    if (x1 > x2 - 8) {
      svgEl.replaceChildren();
      return;
    }
    const y1 = a.top + a.height / 2 - box.top;
    // 接在详情左边、和那一项同高的地方；那一项比详情高或低时接在最近的那一头
    const y2 = Math.min(Math.max(y1, b.top - box.top + DOCK_ANCHOR), b.bottom - box.top - 24);
    const live = leafEl.dataset.tone === "live" ? " live" : "";
    svgEl.innerHTML = `<path class="link open${live}" d="${curve(x1, y1, x2, y2)}"/><circle class="link-end${live}" cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3"/>`;
  }

  function drawLinks() {
    if (!ctx.setup?.plaza || els.canvas.clientWidth === 0) return;
    drawTreeLinks();
    drawDockLink();
  }

  /**
   * 视角变了（平移、缩放）：树里的线跟着 world 一起动，不用重画；画布这一层的那条要重画，
   * 过渡的这段时间里每一帧都画
   */
  let frame = 0;
  function follow(ms = 0) {
    const until = performance.now() + ms;
    cancelAnimationFrame(frame);
    const tick = () => {
      drawDockLink();
      if (performance.now() < until) frame = requestAnimationFrame(tick);
    };
    if (ctx.setup?.plaza && els.canvas.clientWidth > 0) tick();
  }

  return { render, drawLinks, follow, find };
}
