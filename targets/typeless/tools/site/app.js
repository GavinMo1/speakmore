// 阅读页的交互：主题切换、窄屏目录、滚动时高亮当前篇目与小节、渲染 Mermaid 图。
// 页面在没有脚本时也能读：目录是普通链接，图会显示成源码。
(() => {
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const currentTheme = () => root.dataset.theme || (systemDark.matches ? "dark" : "light");

  // ---------- 主题 ----------

  const themeButton = document.querySelector(".theme-toggle");
  const labelTheme = () => {
    themeButton.textContent = currentTheme() === "dark" ? "浅色" : "深色";
  };
  themeButton.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch (error) {
      // 隐私模式下存不了，这次切换仍然生效，只是刷新后回到跟随系统
      console.warn("主题偏好没有保存：", error);
    }
    labelTheme();
    renderDiagrams();
  });
  systemDark.addEventListener("change", () => {
    if (root.dataset.theme) return;
    labelTheme();
    renderDiagrams();
  });
  labelTheme();

  // ---------- 窄屏目录 ----------

  const navButton = document.querySelector(".nav-toggle");
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.createElement("button");
  backdrop.className = "backdrop";
  backdrop.type = "button";
  backdrop.setAttribute("aria-label", "关闭目录");
  document.body.append(backdrop);

  const setNav = (open) => {
    document.body.dataset.nav = open ? "open" : "closed";
    navButton.setAttribute("aria-expanded", String(open));
  };
  navButton.addEventListener("click", () => setNav(document.body.dataset.nav !== "open"));
  backdrop.addEventListener("click", () => setNav(false));
  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a")) setNav(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.dataset.nav === "open") {
      setNav(false);
      navButton.focus();
    }
  });

  // ---------- 滚动高亮 ----------

  const docs = [...document.querySelectorAll("article.doc")];
  const docLinks = new Map([...sidebar.querySelectorAll("a[data-doc]")].map((a) => [a.dataset.doc, a]));
  const rails = new Map([...document.querySelectorAll(".rail-doc")].map((nav) => [nav.dataset.doc, nav]));
  const sectionsOf = new Map(
    docs.map((doc) => [doc.dataset.doc, [...doc.querySelectorAll("h3[id], h4[id]")].filter((h) => railLink(h.id))]),
  );
  function railLink(id) {
    return document.querySelector('.rail a[href="#' + CSS.escape(id) + '"]');
  }

  let activeDoc = null;
  let activeSection = null;
  // 标题越过顶栏下方这条线，就算"读到这里了"
  const line = () => document.querySelector(".topbar").offsetHeight + 32;

  const lastAbove = (elements, limit) => {
    let found = null;
    for (const element of elements) {
      if (element.getBoundingClientRect().top <= limit) found = element;
      else break;
    }
    return found;
  };

  const mark = (previous, next) => {
    if (previous) previous.removeAttribute("aria-current");
    if (next) next.setAttribute("aria-current", "true");
  };

  function updateActive() {
    const limit = line();
    const doc = lastAbove(docs, limit) || docs[0];
    const docId = doc.dataset.doc;
    if (docId !== activeDoc) {
      mark(docLinks.get(activeDoc), docLinks.get(docId));
      if (rails.get(activeDoc)) rails.get(activeDoc).hidden = true;
      if (rails.get(docId)) rails.get(docId).hidden = false;
      activeDoc = docId;
      docLinks.get(docId)?.scrollIntoView({ block: "nearest" });
    }
    const section = lastAbove(sectionsOf.get(docId), limit);
    const sectionId = section ? section.id : null;
    if (sectionId !== activeSection) {
      mark(activeSection && railLink(activeSection), sectionId && railLink(sectionId));
      activeSection = sectionId;
    }
  }

  let scheduled = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        updateActive();
      });
    },
    { passive: true },
  );
  window.addEventListener("resize", updateActive);
  updateActive();

  // ---------- Mermaid 图 ----------

  const figures = [...document.querySelectorAll("figure.diagram")];
  let mermaidReady = null;
  let renderSerial = 0;

  function note(figure, text) {
    let element = figure.querySelector(".diagram-note");
    if (!text) {
      element?.remove();
      return;
    }
    if (!element) {
      element = document.createElement("figcaption");
      element.className = "diagram-note";
      figure.append(element);
    }
    element.textContent = text;
  }

  function loadMermaid() {
    if (!mermaidReady) {
      mermaidReady = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = window.MERMAID_URL;
        script.onload = () => resolve(window.mermaid);
        script.onerror = () => reject(new Error("加载失败：" + window.MERMAID_URL));
        document.head.append(script);
      });
    }
    return mermaidReady;
  }

  // Mermaid 把图缩到容器宽度。图本身很宽时，缩完的字小到看不清，
  // 所以给宽图配一个按钮：默认看全貌，按一下换成原始大小、横向滚动。
  function setupZoom(figure, out) {
    const svg = out.querySelector("svg");
    const natural = svg.viewBox.baseVal.width;
    const style = getComputedStyle(out);
    const available = out.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    let button = figure.querySelector(".diagram-zoom");
    if (natural <= available * 1.3) {
      button?.remove();
      delete figure.dataset.zoom;
      return;
    }
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "diagram-zoom";
      button.addEventListener("click", () => {
        figure.dataset.zoom = figure.dataset.zoom === "in" ? "fit" : "in";
        applyZoom(figure);
      });
      figure.append(button);
    }
    // 切主题会重画，保留用户之前选的大小
    figure.dataset.zoom = figure.dataset.zoom || "fit";
    applyZoom(figure);
  }

  function applyZoom(figure) {
    const svg = figure.querySelector(".diagram-out svg");
    const zoomed = figure.dataset.zoom === "in";
    svg.style.maxWidth = zoomed ? "none" : "";
    svg.style.width = zoomed ? Math.round(svg.viewBox.baseVal.width) + "px" : "";
    const button = figure.querySelector(".diagram-zoom");
    button.textContent = zoomed ? "缩回全图" : "放大看字";
    button.setAttribute("aria-pressed", String(zoomed));
  }

  async function renderDiagrams() {
    if (!figures.length) return;
    const serial = ++renderSerial;
    let mermaid;
    try {
      mermaid = await loadMermaid();
    } catch (error) {
      console.error(error);
      for (const figure of figures) note(figure, "图没有画出来：渲染库需要联网加载。上面是图的源码。");
      return;
    }
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: {
        ...window.DIAGRAM_THEMES[currentTheme()],
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: "14px",
      },
      sequence: { mirrorActors: false, useMaxWidth: true },
      flowchart: { useMaxWidth: true },
    });
    for (const [index, figure] of figures.entries()) {
      // 渲染途中又切了主题：让后一次接手，免得旧主题的图盖在新主题上
      if (serial !== renderSerial) return;
      const source = figure.querySelector(".diagram-src").textContent;
      try {
        const { svg } = await mermaid.render("diagram-" + serial + "-" + index, source);
        const out = figure.querySelector(".diagram-out");
        out.innerHTML = svg;
        figure.dataset.state = "done";
        note(figure, "");
        setupZoom(figure, out);
      } catch (error) {
        console.error("第 " + (index + 1) + " 张图渲染失败", error);
        figure.dataset.state = "error";
        note(figure, "这张图的语法没有通过渲染，上面是源码。错误：" + error.message);
      }
    }
  }

  renderDiagrams();
})();
