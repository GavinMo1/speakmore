import { t } from "../shared/i18n.mjs";

// 首次引导"功能"那一步的演示画面：用代码画的一小块屏幕，按时间线放一遍某个功能。不加外框，窗口直接浮在引导页的底上。
//   语音输入、语音翻译：左边是口述的原话一个字一个字出来，右边一个聊天窗口；底下是真的悬浮条（demo/bar.html），
//     说完整理好的字一次落进输入框（App 是粘贴进去的，不是一个字一个字打）。
//   划词翻译：一个文档窗口，指针划过一句，按键后真的划词卡片（demo/card.html）在选区下方弹出。
// 画面按 880×410 画，整体按容器宽度缩放；悬浮条、卡片是 iframe，跟着一起缩。
// 头像是 Pexels、Unsplash 的照片（免费商用、不必署名，出处见 README 的许可一节）。

const W = 880;
const H = 410;
const BAR = { width: 600, height: 130 };
/** 卡片窗口四周留了 pad 给阴影（和 lookup/card.css 的一样） */
const CARD = { width: 448, height: 250, pad: 32 };

// 演示里的人和语言跟着界面语言走：中文界面里对方用中文聊、语音翻译译成英文、划的是英文文档；英文界面反过来
const HOME = t.locale;
const OTHER = HOME === "zh-CN" ? "en" : "zh-CN";
const AVATARS = { dictate: "chen", translate: HOME === "zh-CN" ? "emma" : "wang" };
const TRANSLATE_TO = [OTHER, "ja"];

const svgIcon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
// 图标：lucide（ISC 许可），和 App 同一套
const ICON = {
  mic: svgIcon('<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>'),
  send: svgIcon(
    '<path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z"/><path d="M6 12h16"/>',
  ),
  home: svgIcon(
    '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  ),
  messages: svgIcon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  activity: svgIcon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  docs: svgIcon(
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8"/>',
  ),
  phone: svgIcon(
    '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  ),
  more: svgIcon('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
  plus: svgIcon('<path d="M5 12h14M12 5v14"/>'),
  type: svgIcon('<path d="M12 4v16M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2M9 20h6"/>'),
  smile: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'),
  at: svgIcon('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>'),
  pointer: '<svg viewBox="0 0 16 22" aria-hidden="true"><path d="M5 1h6M5 21h6M8 1v20"/></svg>',
};
const RAIL = ["home", "messages", "activity", "docs"];
const TOC = ["intro", "start", "config", "plugins", "trouble"];

const escapeHtml = (text) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const say = (key) => escapeHtml(t(`onboarding.scene.${key}`));

/** 口述的原话切成一小段一小段地出来：英文按词，中文按字（标点跟着前一个字） */
function tokens(text) {
  if (/[㐀-鿿]/.test(text)) return text.match(/[^，。、？！…][，。、？！…]*/gu) ?? [text];
  return text.split(/(?<=\s)/);
}

function titlebar(platform) {
  return platform === "win32"
    ? '<span class="win-controls"><i>—</i><i>☐</i><i>✕</i></span>'
    : '<span class="lights"><i></i><i></i><i></i></span>';
}

/**
 * @param {HTMLElement} host 放画面的容器（宽度由外面定，高度按比例）
 * @param {{ platform: string, chords: () => Record<string, string[]> }} options chords：每个功能演示时按的组合（code）
 */
export function createScene(host, { platform, chords }) {
  host.classList.add("scene");
  host.innerHTML = `
    <div class="scene-canvas">
      <section class="app chat" aria-hidden="true">
        <header class="titlebar">${titlebar(platform)}</header>
        <nav class="rail">
          ${RAIL.map(
            (id) =>
              `<span class="rail-item${id === "messages" ? " on" : ""}">${ICON[id]}<span>${say(`rail.${id}`)}</span></span>`,
          ).join("")}
        </nav>
        <div class="pane">
          <header class="peer">
            <span class="avatar small"><img data-slot="peer-avatar" alt="" /><span class="presence"></span></span>
            <span class="peer-name" data-slot="contact"></span>
            <span class="peer-tools">${ICON.phone}${ICON.more}</span>
          </header>
          <div class="messages">
            <p class="day"><span>${say("today")}</span></p>
            <article class="message">
              <span class="avatar"><img data-slot="avatar" alt="" /></span>
              <p class="message-meta"><b data-slot="sender"></b><time>10:24</time></p>
              <p class="message-text" data-slot="earlier"></p>
              <p class="message-text" data-slot="incoming"></p>
            </article>
          </div>
          <div class="composer">
            <p class="field"><span class="typed" data-slot="typed"></span><span class="caret"></span><span class="placeholder" data-slot="placeholder"></span></p>
            <div class="composer-tools">
              <span class="tool round">${ICON.plus}</span>
              <span class="tool">${ICON.type}</span>
              <span class="tool">${ICON.smile}</span>
              <span class="tool">${ICON.at}</span>
              <span class="send">${ICON.send}</span>
            </div>
          </div>
        </div>
      </section>
      <aside class="speech" aria-hidden="true">
        <p class="speech-label"><span class="speech-mic">${ICON.mic}</span>${say("spoken")}<span class="live"></span></p>
        <p class="speech-text" data-slot="said"></p>
      </aside>
      <section class="app doc" aria-hidden="true">
        <header class="titlebar">${titlebar(platform)}<span class="title">${say("lookup.title")} · ${say("lookup.site")}</span></header>
        <nav class="toc">${TOC.map((id) => `<span${id === "start" ? ' class="on"' : ""}>${say(`lookup.toc.${id}`)}</span>`).join("")}</nav>
        <article class="page">
          <p class="crumb">${say("lookup.site")} / ${say("lookup.toc.start")}</p>
          <h3>${say("lookup.title")}</h3>
          <p><span>${say("lookup.before")}</span><span class="sel" data-slot="selected">${say("lookup.selected")}</span><span>${say("lookup.after")}</span></p>
          <p class="more">${say("lookup.more")}</p>
        </article>
      </section>
      <span class="pointer">${ICON.pointer}</span>
      <iframe class="demo-bar" src="demo/bar.html" title="" tabindex="-1"></iframe>
      <iframe class="demo-card" src="demo/card.html" title="" tabindex="-1"></iframe>
    </div>`;
  const canvas = host.querySelector(".scene-canvas");
  const slot = (name) => host.querySelector(`[data-slot="${name}"]`);
  const barFrame = host.querySelector(".demo-bar");
  const cardFrame = host.querySelector(".demo-card");
  // 尺寸经 CSSOM 写：页面的 CSP 不许 HTML 里写 style 属性
  const size = (node, { width, height }) => Object.assign(node.style, { width: `${width}px`, height: `${height}px` });
  size(canvas, { width: W, height: H });
  size(barFrame, BAR);
  size(cardFrame, CARD);
  const pointer = host.querySelector(".pointer");
  const selection = slot("selected");

  // 两个 iframe 加载好了（报了 bar-ready、card-ready）才能发消息
  const loaded = (frame, type) =>
    new Promise((done) => {
      const listen = ({ source, data }) => {
        if (source === frame.contentWindow && data?.type === type) {
          window.removeEventListener("message", listen);
          done();
        }
      };
      window.addEventListener("message", listen);
    });
  const ready = Promise.all([loaded(barFrame, "bar-ready"), loaded(cardFrame, "card-ready")]);
  const toBar = (message) => barFrame.contentWindow?.postMessage(message, "*");
  const toCard = (message) => cardFrame.contentWindow?.postMessage(message, "*");

  // 按容器宽度缩放
  const fit = () => {
    const scale = host.clientWidth / W;
    canvas.style.transform = `scale(${scale})`;
    host.style.height = `${H * scale}px`;
  };
  new ResizeObserver(fit).observe(host);
  fit();

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  /** 每放一遍换一个号：换了号，正在放的那一遍就停下（sleep 抛出 stopped） */
  let run = 0;
  let levelTimer = null;
  const stopped = Symbol("stopped");
  const sleep = (ms, ticket) =>
    new Promise((done, fail) =>
      setTimeout(() => (ticket === run ? done() : fail(stopped)), reduced.matches ? Math.min(ms, 400) : ms),
    );

  /** 画成这个功能的起始样子：窗口、字都摆好，悬浮条、卡片收着 */
  function show(feature) {
    clearInterval(levelTimer);
    host.dataset.feature = feature;
    host.dataset.phase = "idle";
    toBar({ type: "hide" });
    toCard({ type: "show", phase: "hidden" });
    if (feature === "lookup") {
      selection.style.backgroundSize = "0% 100%";
      pointer.classList.remove("on");
      placePointer(0);
      return;
    }
    const contact = t(`onboarding.scene.${feature}.contact`);
    slot("contact").textContent = contact;
    slot("sender").textContent = contact;
    for (const name of ["avatar", "peer-avatar"]) slot(name).src = `avatars/${AVATARS[feature]}.jpg`;
    slot("earlier").textContent = t(`onboarding.scene.${feature}.earlier`);
    slot("incoming").textContent = t(`onboarding.scene.${feature}.incoming`);
    slot("placeholder").textContent = t("onboarding.scene.message", { name: contact });
    slot("typed").textContent = "";
    slot("said").replaceChildren();
  }

  /** 选区每一行在画布上的位置（getClientRects 量的是缩放后的，除回去） */
  function selectionLines() {
    const box = canvas.getBoundingClientRect();
    const scale = box.width / W;
    return [...selection.getClientRects()].map((rect) => ({
      left: (rect.left - box.left) / scale,
      top: (rect.top - box.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    }));
  }

  /** 选区刷到 p（0–1）时指针在哪：沿着一行一行走，和底色刷到的地方一致 */
  function pointerAt(lines, p) {
    const total = lines.reduce((sum, line) => sum + line.width, 0);
    let rest = p * total;
    for (const line of lines) {
      if (rest <= line.width || line === lines.at(-1)) {
        return { x: line.left + Math.min(rest, line.width), y: line.top + line.height * 0.12 };
      }
      rest -= line.width;
    }
    return { x: 0, y: 0 };
  }

  function placePointer(p) {
    const lines = selectionLines();
    if (lines.length === 0) return;
    const { x, y } = pointerAt(lines, p);
    pointer.style.translate = `${x - 8}px ${y}px`;
  }

  /** 刷选区：底色和指针一起走，一帧一帧算（行内元素的底色是整段连着切开的，刷到 p 就是沿各行走到 p） */
  function sweep(duration, ticket) {
    const lines = selectionLines();
    const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
    const started = performance.now();
    return new Promise((done, fail) => {
      const frame = (now) => {
        if (ticket !== run) return fail(stopped);
        const p = reduced.matches ? 1 : ease(Math.min(1, (now - started) / duration));
        selection.style.backgroundSize = `${p * 100}% 100%`;
        const { x, y } = pointerAt(lines, p);
        pointer.style.translate = `${x - 8}px ${y}px`;
        if (p < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
  }

  /** 说话时悬浮条的声波：有起伏的瞬时音量，50 ms 一个，像人在说话 */
  function speak(ticket) {
    let phase = 0;
    levelTimer = setInterval(() => {
      if (ticket !== run) return clearInterval(levelTimer);
      phase += 0.5 + Math.random() * 0.4;
      const syllable = Math.max(0, Math.sin(phase));
      toBar({ type: "level", value: 0.12 + syllable * (0.35 + Math.random() * 0.45) });
    }, 50);
  }

  async function playVoice(feature, ticket, onPress) {
    const bar = (view) => toBar({ type: "show", view, feature, keys: chords()[feature], to: TRANSLATE_TO });
    await sleep(700, ticket);
    onPress();
    bar("starting");
    await sleep(350, ticket);
    host.dataset.phase = "speaking";
    bar("recording");
    speak(ticket);
    const said = slot("said");
    const parts = tokens(t(`onboarding.scene.${feature}.said`));
    const step = 2900 / parts.length;
    for (const part of parts) {
      const span = document.createElement("span");
      span.textContent = part;
      said.append(span);
      requestAnimationFrame(() => span.classList.add("on"));
      await sleep(step, ticket);
    }
    await sleep(500, ticket);
    clearInterval(levelTimer);
    onPress();
    host.dataset.phase = "finishing";
    bar("finishing");
    await sleep(1200, ticket);
    host.dataset.phase = "written";
    slot("typed").textContent = t(`onboarding.scene.${feature}.wrote`);
    bar("done");
    await sleep(2600, ticket);
  }

  async function playLookup(ticket, onPress) {
    await sleep(500, ticket);
    pointer.classList.add("on");
    await sleep(500, ticket);
    host.dataset.phase = "selecting";
    await sweep(1100, ticket);
    await sleep(500, ticket);
    onPress();
    // 卡片放在选区下方，左边和选区对齐
    const lines = selectionLines();
    const left = Math.min(...lines.map((line) => line.left));
    const bottom = lines.at(-1).top + lines.at(-1).height;
    cardFrame.style.translate = `${Math.min(left, W - CARD.width + CARD.pad) - CARD.pad}px ${bottom + 6 - CARD.pad}px`;
    host.dataset.phase = "card";
    toCard({ type: "show", phase: "loading", language: HOME });
    await sleep(900, ticket);
    toCard({ type: "show", phase: "done", language: HOME, text: t("onboarding.scene.lookup.wrote") });
    await sleep(3400, ticket);
  }

  return {
    ready,
    /**
     * 从头放一遍这个功能。onPress：时间线上"按下快捷键"的那几下（外面让键帽跟着亮）。
     * 放完 resolve true；中途被别的一遍打断、停下 resolve false
     */
    async play(feature, { onPress = () => {} } = {}) {
      const ticket = ++run;
      show(feature);
      try {
        if (feature === "lookup") await playLookup(ticket, onPress);
        else await playVoice(feature, ticket, onPress);
        return true;
      } catch (error) {
        if (error === stopped) return false;
        throw error;
      }
    },
    /** 停下正在放的那一遍，回到起始样子 */
    stop() {
      run += 1;
      show(host.dataset.feature ?? "dictate");
    },
  };
}

/** 每个功能放一遍多久（上面的时间线），功能页底下那条进度线跟着走 */
export const PLAY_MS = Object.freeze({ dictate: 8250, translate: 8250, lookup: 6400 });
