import { LOCALES, SYSTEM_LOCALE } from "../../i18n/index.mjs";
import { t } from "../shared/i18n.mjs";
import { describeError, keyMissing, permissionDenied, permissionText } from "../shared/setup-text.mjs";

// 设置对话框：原版的"设置中心"，左边一列菜单。我们的三页：通用（热键、主题、语言、本机模型的下载源、开机启动）、
// 权限、关于。
// 识别方式、模型和 key 不在这里：在侧栏的"模型"一页（models.mjs）。
// 状态都在主进程，这里只负责画出来和转达用户的操作。

const $ = (id) => document.getElementById(id);

const PANES = ["general", "permissions", "about"];

/**
 * 还差的东西在哪补：key 在侧栏"模型"一页的密钥表，其余是设置的权限页（小帮手停了也是，重新检查在那页）；
 * 两样都差时先补 key
 * @returns {{ route: "models", tab: "keys" } | { pane: string }}
 */
export function fixTarget(setup) {
  if (keyMissing(setup)) return { route: "models", tab: "keys" };
  return { pane: permissionDenied(setup) || setup.helper === "stopped" ? "permissions" : "general" };
}

/**
 * @param {{ refresh: () => Promise<object> }} options refresh：重新问主进程要一份状态，并让整个窗口跟着更新
 */
export function createSettings({ refresh }) {
  const dialog = $("settings");

  function showPane(pane) {
    const name = PANES.includes(pane) ? pane : "general";
    for (const section of dialog.querySelectorAll(".pane")) section.hidden = section.dataset.pane !== name;
    for (const item of dialog.querySelectorAll(".menu-item")) {
      if (item.dataset.pane === name) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    }
  }

  // ---------- 通用：热键、主题、语言、开机启动 ----------

  /** 一组选项：[值, 写什么]，选中现在的那个 */
  const options = (choices, current) =>
    choices.map(([value, label]) => new Option(label, value, false, value === current));

  function renderGeneral(setup) {
    $("hotkey").replaceChildren(
      ...options(
        setup.hotkey.choices.map((id) => [id, t(`hotkeys.${id}.name`)]),
        setup.hotkey.value,
      ),
    );
    $("theme").replaceChildren(
      ...options(
        setup.theme.choices.map((id) => [id, t(`themes.${id}.name`)]),
        setup.theme.value,
      ),
    );
    // 跟随系统，再列出每种语言（名字用它自己的语言写）
    $("language").replaceChildren(
      ...options(
        [[SYSTEM_LOCALE, t("language.system")], ...LOCALES.map(({ id, name }) => [id, name])],
        setup.language.value,
      ),
    );
    $("model-source").replaceChildren(
      ...options(
        setup.local.source.choices.map((id) => [id, t(`modelSources.${id}`)]),
        setup.local.source.value,
      ),
    );
    $("acceleration").replaceChildren(
      ...options(
        setup.local.acceleration.choices.map((id) => [id, t(`accelerations.${id}`)]),
        setup.local.acceleration.value,
      ),
    );
    $("bar-hint").checked = setup.barHint === "on";
    $("open-at-login").checked = setup.openAtLogin.enabled;
    $("open-at-login-row").hidden = !setup.openAtLogin.supported;
  }

  function showNote(id, message, tone = "") {
    $(id).textContent = t.text(message);
    $(id).dataset.tone = tone;
    $(id).hidden = !message;
  }

  $("hotkey").addEventListener("change", async (event) => {
    showNote("hotkey-note", null);
    try {
      const result = await window.speakmore.setHotkey(event.target.value);
      showNote("hotkey-note", result.note ?? null);
    } catch (error) {
      showNote("hotkey-note", t("preferences.hotkeyFailed", { reason: describeError(error) }), "problem");
    }
    await refresh();
  });

  $("theme").addEventListener("change", async (event) => {
    showNote("general-problem", null);
    showNote("theme-note", null);
    try {
      const result = await window.speakmore.setTheme(event.target.value);
      showNote("theme-note", result.note ?? null);
    } catch (error) {
      showNote("general-problem", t("preferences.themeFailed", { reason: describeError(error) }), "problem");
    }
    await refresh();
  });

  // 换了语言：主进程把这个窗口按新的语言重新加载，回到这一页；被环境变量盖着时语言不变，留在这里说一句
  $("language").addEventListener("change", async (event) => {
    showNote("general-problem", null);
    showNote("language-note", null);
    try {
      const result = await window.speakmore.setLanguage(event.target.value);
      showNote("language-note", result.note ?? null);
    } catch (error) {
      showNote("general-problem", t("preferences.languageFailed", { reason: describeError(error) }), "problem");
    }
    await refresh();
  });

  $("model-source").addEventListener("change", async (event) => {
    showNote("general-problem", null);
    showNote("source-note", null);
    try {
      const result = await window.speakmore.setModelSource(event.target.value);
      showNote("source-note", result.note ?? null);
    } catch (error) {
      showNote("general-problem", t("preferences.sourceFailed", { reason: describeError(error) }), "problem");
    }
    await refresh();
  });

  $("acceleration").addEventListener("change", async (event) => {
    showNote("general-problem", null);
    showNote("acceleration-note", null);
    try {
      const result = await window.speakmore.setAcceleration(event.target.value);
      showNote("acceleration-note", result.note ?? null);
    } catch (error) {
      showNote("general-problem", t("preferences.accelerationFailed", { reason: describeError(error) }), "problem");
    }
    await refresh();
  });

  $("bar-hint").addEventListener("change", async (event) => {
    showNote("general-problem", null);
    showNote("bar-hint-note", null);
    try {
      const result = await window.speakmore.setBarHint(event.target.checked ? "on" : "off");
      showNote("bar-hint-note", result.note ?? null);
    } catch (error) {
      showNote("general-problem", t("preferences.barHintFailed", { reason: describeError(error) }), "problem");
    }
    await refresh();
  });

  $("open-at-login").addEventListener("change", async (event) => {
    showNote("general-problem", null);
    try {
      await window.speakmore.setOpenAtLogin(event.target.checked);
    } catch (error) {
      showNote("general-problem", t("preferences.loginFailed", { reason: describeError(error) }), "problem");
    }
    await refresh();
  });

  // ---------- 权限 ----------

  function renderPermissions(setup) {
    for (const row of dialog.querySelectorAll("[data-permission]")) {
      const name = row.dataset.permission;
      const [label, tone, action] = permissionText(name, setup.permissions[name], t);
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
    /** @param {string} [pane] 打开哪一页 */
    open(pane = "general") {
      showPane(pane);
      if (!dialog.open) dialog.showModal();
    },

    render(setup) {
      renderGeneral(setup);
      renderPermissions(setup);
      $("about-version").textContent = `v${setup.version}`;
      $("about-home").textContent = setup.home;
      // 菜单上标个红点：这一页里有东西要补
      const flagged = { permissions: permissionDenied(setup) };
      for (const dot of dialog.querySelectorAll(".menu-dot")) dot.hidden = !flagged[dot.dataset.for];
    },
  };
}
