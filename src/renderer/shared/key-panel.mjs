import { providerIcon } from "./provider-icons.mjs";
import { describeError } from "./setup-text.mjs";

// 选用哪家的模型、填 key：主窗口设置里的"模型"一页和首次引导的第一步用的是这同一块。
// 状态都在主进程，这里只负责画出来和转达用户的操作。key 只从这里往主进程走一趟，不会从主进程回到页面上。

/** 夹在中文里的词：英文开头或结尾的那一侧和汉字之间空一格（"去 Google AI Studio 申请"、"去 OpenAI 开发者平台申请"） */
const spacedInChinese = (text) =>
  `${/^[A-Za-z0-9]/.test(text) ? " " : ""}${text}${/[A-Za-z0-9]$/.test(text) ? " " : ""}`;

/** 不是正在用的那家：只说它有没有 key、在哪（主进程只报来源，不解密） */
function otherKeyText(provider) {
  if (provider.key === "env") return [`环境变量 ${provider.keyEnv} 里有一把`, "pending"];
  if (provider.key === "stored") return ["已存一把", "pending"];
  return [`未填 · 填一把即可改用 ${provider.name}`, ""];
}

function keyText(key, provider) {
  // 启动时够不着的话先用着，如实说还没验证
  const unverified = key.verified === false ? ` · 未验证（启动时没连上 ${provider.name}）` : "";
  switch (key.state) {
    case "ready":
      if (key.source === "env") return [`用环境变量 ${provider.keyEnv} · 未保存${unverified}`, "ok"];
      if (key.source === "external") return ["由单独启动的服务端配置", "ok"];
      return unverified ? [`已保存${unverified}`, "pending"] : ["已保存 · 验证通过", "ok"];
    case "checking":
      return ["验证中…", "pending"];
    case "rejected":
      // 三种情况要做的事不一样：只有最后一种是在下面换一把就能解决的
      if (key.cause === "other") {
        return [`验证没通过：${key.problem} · key 未必有错，先查 speakmore model`, "problem"];
      }
      if (key.source === "env") {
        return [`环境变量 ${provider.keyEnv} 的 key 不能用：${key.problem} · 改对或去掉后重启`, "problem"];
      }
      return [`这把不能用：${key.problem}`, "problem"];
    case "unreadable":
      return [key.problem, "problem"];
    default:
      return ["未填", "problem"];
  }
}

const MARKUP = `
  <div class="providers" role="radiogroup" aria-label="模型"></div>
  <div class="key-state-row">
    <p class="state"></p>
    <button type="button" class="button primary use-provider" hidden>改用</button>
  </div>
  <form class="key-form">
    <input type="password" class="input key-input" autocomplete="off" spellcheck="false"
      placeholder="粘贴 key" aria-label="API key" />
    <button type="button" class="button paste-key">粘贴</button>
    <button type="submit" class="button primary save-key">保存并验证</button>
  </form>
  <p class="problem key-problem" role="alert" hidden></p>
  <p class="hint key-note" hidden></p>
  <p class="links">
    <button type="button" class="link open-key-page">去 Google AI Studio 申请一把</button>
    <button type="button" class="link forget-key" hidden>删除 key</button>
  </p>`;

/**
 * 把这一块放进 container。
 * @param {HTMLElement} container
 * @param {{ refresh: () => Promise<unknown> }} options refresh：存完、换完以后让整个窗口重新问一遍状态
 * @returns {{ render: (setup: object) => void }}
 */
export function createKeyPanel(container, { refresh }) {
  container.innerHTML = MARKUP;
  const find = (selector) => container.querySelector(selector);
  const keyInput = find(".key-input");
  const saveButton = find(".save-key");
  const useButton = find(".use-provider");
  const keyProblem = find(".key-problem");
  const keyNote = find(".key-note");
  /** 正在保存或者正在改用时不让重复提交，也不让别处的刷新把按钮重新点亮 */
  let saving = false;
  /** 现在看着的是哪一家（id）。打开时是正在用的那家；点了别家就看别家的 key，可以改用它 */
  let selected = null;
  /** 最近一次拿到的状态 */
  let latest = null;

  const show = (node, message) => {
    node.textContent = message ?? "";
    node.hidden = !message;
  };

  /** 每家一个按钮：图标和名字，正在用的那家后面打个勾。有没有 key 在下面那行说 */
  function renderProviders(providers, currentId) {
    find(".providers").replaceChildren(
      ...providers.map((provider) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "provider";
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(provider.id === selected));
        const name = document.createElement("span");
        name.className = "provider-name";
        name.textContent = provider.name;
        const icon = providerIcon(provider.id);
        button.append(...(icon ? [icon, name] : [name]));
        if (provider.id === currentId) {
          const mark = document.createElement("span");
          mark.className = "provider-in-use";
          mark.title = "使用中";
          mark.textContent = "✓";
          mark.setAttribute("aria-label", "使用中");
          button.append(mark);
        }
        button.addEventListener("click", () => {
          if (selected === provider.id) return;
          selected = provider.id;
          keyInput.value = "";
          show(keyProblem, null);
          show(keyNote, null);
          render(latest);
        });
        return button;
      }),
    );
  }

  function render(setup) {
    latest = setup;
    // 这一块说的是选中的那一家：它的 key 在不在、去哪申请；不是正在用的那家时可以改用它
    const current = setup.provider;
    const providers = setup.providers;
    if (!providers.some(({ id }) => id === selected)) selected = current.id;
    const provider = providers.find(({ id }) => id === selected);
    const isCurrent = provider.id === current.id;
    // 连着单独启动的服务端时用哪家由那边定，不给选
    find(".providers").hidden = !setup.switchable;
    if (setup.switchable) renderProviders(providers, current.id);
    keyInput.setAttribute("aria-label", `${provider.name} API key`);
    find(".open-key-page").textContent = `去${spacedInChinese(provider.site)}申请`;
    const [text, tone] = isCurrent ? keyText(setup.key, provider) : otherKeyText(provider);
    find(".state").textContent = text;
    find(".state").dataset.tone = tone;
    // 别家已经有 key：一点就改用它；没有的话在下面填一把，保存时一起改用
    useButton.hidden = isCurrent || provider.key === null;
    if (!saving) useButton.textContent = `改用 ${provider.name}`;
    useButton.disabled = saving;
    if (!saving) saveButton.textContent = isCurrent ? "保存并验证" : `保存并改用 ${provider.name}`;
    // 一次只有一个主按钮：别家已经有 key 时主要是"改用"，填一把新的退到次要
    saveButton.classList.toggle("primary", useButton.hidden);
    // 环境变量和外部服务端的 key 不归这里管，不提供"删除"
    find(".forget-key").hidden = (isCurrent ? setup.key.source : provider.key) !== "stored";
    const editable = setup.key.source !== "external";
    keyInput.disabled = !editable;
    find(".paste-key").disabled = !editable;
    saveButton.disabled = saving || !editable;
  }

  /**
   * 存 key、改用别家都走这里：一次只做一件，做的时候按钮上写着"验证中…"，做完刷新。
   * @param {HTMLButtonElement} button
   * @param {() => Promise<{ ok: boolean, problem?: string, note?: string }>} action
   */
  async function submit(button, action) {
    if (saving) return;
    saving = true;
    const label = button.textContent;
    saveButton.disabled = true;
    useButton.disabled = true;
    button.textContent = "验证中…";
    show(keyProblem, null);
    show(keyNote, null);
    try {
      const result = await action();
      if (result.ok) {
        keyInput.value = "";
        show(keyNote, result.note ?? null);
      } else show(keyProblem, result.problem);
    } catch (error) {
      show(keyProblem, `没成功：${describeError(error)}`);
    } finally {
      saving = false;
      button.textContent = label;
      await refresh();
    }
  }

  find(".key-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = keyInput.value;
    const isCurrent = selected === latest.provider.id;
    // 选中的不是正在用的那家：存这把 key 的同时改用它，验证过才换
    submit(saveButton, () =>
      isCurrent ? window.speakmore.saveKey(value) : window.speakmore.useProvider(selected, value),
    );
  });

  useButton.addEventListener("click", () => submit(useButton, () => window.speakmore.useProvider(selected)));

  find(".paste-key").addEventListener("click", async () => {
    const text = (await window.speakmore.readClipboard()).trim();
    if (text === "") {
      show(keyProblem, "剪贴板是空的");
      return;
    }
    show(keyProblem, null);
    keyInput.value = text;
    keyInput.focus();
  });

  find(".forget-key").addEventListener("click", async () => {
    const provider = latest.providers.find(({ id }) => id === selected) ?? latest.provider;
    const inUse = provider.id === latest.provider.id;
    const consequence = inUse ? "删了要重填才能用" : "";
    if (!window.confirm(`删除 ${provider.name} key？${consequence}`)) return;
    await window.speakmore.forgetKey(selected);
    await refresh();
  });

  find(".open-key-page").addEventListener("click", () => window.speakmore.openKeyPage(selected));

  return { render };
}
