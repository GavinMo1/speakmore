import { createKeyPanel } from "../shared/key-panel.mjs";
import { describeError, keyMissing, permissionDenied, permissionText } from "../shared/setup-text.mjs";

// 设置对话框：原版的"设置中心"，左边一列菜单。我们的四页：设置（热键、主题、开机启动）、
// 模型（用哪家、填 key，对应原版"账户"的位置）、权限、关于。
// 状态都在主进程，这里只负责画出来和转达用户的操作。

const $ = (id) => document.getElementById(id);

const PANES = ["general", "model", "permissions", "about"];

/** 还差的东西在哪一页补：key 在"模型"，其余是权限；两样都差时先补 key */
export function paneFor(setup) {
  if (keyMissing(setup)) return "model";
  return permissionDenied(setup) ? "permissions" : "general";
}

/**
 * @param {{ refresh: () => Promise<object> }} options refresh：重新问主进程要一份状态，并让整个窗口跟着更新
 */
export function createSettings({ refresh }) {
  const dialog = $("settings");
  const keyPanel = createKeyPanel($("key-panel"), { refresh });
  /** 最近一次拿到的状态 */
  let latest = null;

  function showPane(pane) {
    const name = PANES.includes(pane) ? pane : "general";
    for (const section of dialog.querySelectorAll(".pane")) section.hidden = section.dataset.pane !== name;
    for (const item of dialog.querySelectorAll(".menu-item")) {
      if (item.dataset.pane === name) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    }
  }

  // ---------- 设置：热键、主题、开机启动 ----------

  function renderGeneral(setup) {
    $("hotkey").replaceChildren(
      ...setup.hotkey.choices.map(({ id, label }) => new Option(label, id, false, id === setup.hotkey.value)),
    );
    $("theme").replaceChildren(
      ...setup.theme.choices.map(({ id, name }) => new Option(name, id, false, id === setup.theme.value)),
    );
    const openAtLogin = $("open-at-login");
    openAtLogin.checked = setup.openAtLogin.enabled;
    openAtLogin.disabled = !setup.openAtLogin.supported;
    $("open-at-login-desc").textContent = setup.openAtLogin.supported
      ? "登录这台电脑时自动打开 SpeakMore。"
      : "现在是从终端启动的，装成应用之后才能设置。";
  }

  function showNote(id, message, tone = "") {
    $(id).textContent = message ?? "";
    $(id).dataset.tone = tone;
    $(id).hidden = !message;
  }

  $("hotkey").addEventListener("change", async (event) => {
    showNote("hotkey-note", null);
    try {
      const result = await window.speakmore.setHotkey(event.target.value);
      showNote("hotkey-note", result.note ?? null);
    } catch (error) {
      showNote("hotkey-note", `没有改成：${describeError(error)}`, "problem");
    }
    await refresh();
  });

  $("theme").addEventListener("change", async (event) => {
    showNote("general-problem", null);
    try {
      await window.speakmore.setTheme(event.target.value);
    } catch (error) {
      showNote("general-problem", `主题没有换成：${describeError(error)}`, "problem");
    }
    await refresh();
  });

  $("open-at-login").addEventListener("change", async (event) => {
    showNote("general-problem", null);
    try {
      await window.speakmore.setOpenAtLogin(event.target.checked);
    } catch (error) {
      showNote("general-problem", `开机启动没有设置上：${describeError(error)}`, "problem");
    }
    await refresh();
  });

  // ---------- 权限 ----------

  function renderPermissions(setup) {
    for (const row of dialog.querySelectorAll("[data-permission]")) {
      const name = row.dataset.permission;
      const [label, tone, action] = permissionText(name, setup.permissions[name]);
      const granted = row.querySelector(".granted");
      granted.textContent = label;
      granted.dataset.tone = tone;
      row.querySelector("button").textContent = action;
    }
  }

  for (const row of dialog.querySelectorAll("[data-permission]")) {
    row
      .querySelector("button")
      .addEventListener("click", () => window.speakmore.openPrivacySettings(row.dataset.permission));
  }
  $("recheck").addEventListener("click", () => window.speakmore.recheckPermissions());

  // ---------- 关于 ----------

  $("open-homepage").addEventListener("click", () => window.speakmore.openHomepage());

  // ---------- 对话框本身 ----------

  for (const item of dialog.querySelectorAll(".menu-item")) {
    item.addEventListener("click", () => showPane(item.dataset.pane));
  }
  $("settings-close").addEventListener("click", () => dialog.close());
  // 点对话框外面的那层暗底也关掉
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) dialog.close();
  });

  return {
    /** @param {string} [pane] 打开哪一页；"auto" 是还差东西的那一页 */
    open(pane = "general") {
      showPane(pane === "auto" && latest ? paneFor(latest) : pane);
      if (!dialog.open) dialog.showModal();
    },

    render(setup) {
      latest = setup;
      renderGeneral(setup);
      keyPanel.render(setup);
      renderPermissions(setup);
      $("about-version").textContent = `v${setup.version}`;
      $("about-home").textContent = setup.home;
      // 菜单上标个红点：这一页里有东西要补
      const flagged = { model: keyMissing(setup), permissions: permissionDenied(setup) };
      for (const dot of dialog.querySelectorAll(".menu-dot")) dot.hidden = !flagged[dot.dataset.for];
    },
  };
}
