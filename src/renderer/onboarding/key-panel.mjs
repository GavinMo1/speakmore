import { h, svg } from "../shared/dom.mjs";
import { t } from "../shared/i18n.mjs";
import { providerIcon } from "../shared/provider-icons.mjs";
import { describeError } from "../shared/setup-text.mjs";

// 首次引导"准备"那一步里选哪家、填密钥的一块。一块只管一种方式的几家（原生收音频的，或者转写 + 润色里润色的）。
// 一家一行（几家都排得齐，不按列数换行）；选中的那一行就地展开，填密钥、检测都在那一行里，样子同主窗口的密钥表。
// 选哪家是引导的打算（plan.mjs），这里只画出来、转达点了哪家；换不换过去由引导看还差什么再定，这里不换。
// 状态都在主进程，密钥只从这里往主进程走一趟，不会从主进程回到页面上。
// 下载模型时状态一秒变好几次：各行和输入框只建一次，之后只改字和属性，正在输入的字和焦点不会丢。

/**
 * 服务没拿着它的 key：只有来自环境变量时要多说一句（主进程只报来源，不解密）。
 * 配没配行头已经写着，展开的那一行不再重复，是 null
 */
function otherKeyText(vendor) {
  return vendor.key === "env" ? [t("keyPanel.other.env", { variable: vendor.keyEnv }), "ok"] : null;
}

/** 服务正拿着它的 key：说那把 key 的状态。还没配的行头已经写着，是 null */
function keyText(key, vendor) {
  // 启动时够不着的话先用着，如实说还没验证
  const unverified = key.verified === false;
  const named = { variable: vendor.keyEnv, provider: vendor.name, problem: key.problem };
  switch (key.state) {
    case "ready":
      if (key.source === "env")
        return [t(unverified ? "keyPanel.state.envUnverified" : "keyPanel.state.env", named), "ok"];
      if (key.source === "external") return [t("keyPanel.state.external"), "ok"];
      return unverified ? [t("keyPanel.state.savedUnverified", named), "pending"] : [t("keyPanel.state.saved"), "ok"];
    case "checking":
      return [t("keyPanel.state.checking"), "pending"];
    case "rejected":
      // 三种情况要做的事不一样：只有最后一种是在下面换一把就能解决的
      if (key.cause === "other") return [t("keyPanel.state.checkFailed", named), "problem"];
      if (key.source === "env") return [t("keyPanel.state.envRejected", named), "problem"];
      return [t("keyPanel.state.rejected", named), "problem"];
    case "unreadable":
      return [t.text(key.problem), "problem"];
    default:
      return null;
  }
}

/**
 * 把这一块放进 container。
 * @param {HTMLElement} container
 * @param {object} options
 * @param {"native" | "local"} options.mode 哪种方式的几家；检测时按这种方式查
 * @param {string} options.label 读屏软件念的这一组叫什么
 * @param {(setup: object) => object[]} options.vendors 列哪几家（plan.mjs 的 vendorsFor）
 * @param {(setup: object, id: string) => boolean} options.hasKey 这家有没有能用的 key（plan.mjs 的 hasKey）
 * @param {() => string} options.picked 引导打算用哪家
 * @param {(id: string) => void} options.pick 点了一家
 * @param {(id: string) => object} options.checkChanges 检测这家时连带的设置（还没换过去的）
 * @param {() => Promise<unknown>} options.refresh 存完、删完以后让整个窗口重新问一遍状态
 * @param {() => void} options.onSaved 存好了一把 key（引导看齐了没有，齐了就换过去）
 * @returns {{ render: (setup: object) => void }}
 */
export function createKeyPanel(
  container,
  { mode, label, vendors, hasKey, picked, pick, checkChanges, refresh, onSaved },
) {
  /** 正在保存时不让重复提交，也不让别处的刷新把按钮重新点亮 */
  let saving = false;
  /** 最近一次拿到的状态 */
  let latest = null;
  /** 有 key 的那家点了"更换"：摆出输入框。换一家看、换好了就收起 */
  let replacing = false;
  /** 每家最近一次检测：{ tone, text, ticket }。ticket 认是哪一次，查到一半又查了一次的，先回来的旧结果不要 */
  const checks = new Map();
  /** 每家一行：{ row, head, state }，按 id；几家变了才重建 */
  const rows = new Map();

  // ---------- 展开的那一块：只建一次，选了哪家就挪到那一行底下 ----------

  const input = h("input", {
    type: "password",
    class: "key-input",
    autocomplete: "off",
    spellcheck: "false",
  });
  const pasteButton = h(
    "button",
    {
      type: "button",
      class: "icon-button paste-key",
      title: t("keyPanel.paste"),
      "aria-label": t("keyPanel.paste"),
      onclick: paste,
    },
    svg("i-clipboard-paste"),
  );
  const saveButton = h("button", { type: "submit", class: "button primary save-key", text: t("plaza.keys.save") });
  const form = h(
    "form",
    { class: "key-form", novalidate: true, onsubmit: save },
    h("label", { class: "key-field" }, svg("i-key-round"), input, pasteButton),
    saveButton,
  );
  const state = h("p", { class: "state" });
  const checkButton = h("button", {
    type: "button",
    class: "button small",
    text: t("keyPanel.check.button"),
    onclick: () => check(),
  });
  const checkResult = h("p", { class: "check-result", role: "status" });
  const keyProblem = h("p", { class: "callout key-problem", role: "alert" });
  const keyNote = h("p", { class: "hint key-note" });
  const keyPage = h(
    "button",
    { type: "button", class: "key-link", onclick: () => window.speakmore.openKeyPage(picked()) },
    h("span", { text: t("plaza.keys.get") }),
    svg("i-external-link"),
  );
  const replaceButton = h("button", { type: "button", class: "key-link", onclick: toggleReplace });
  const forgetButton = h("button", {
    type: "button",
    class: "key-link",
    text: t("plaza.keys.remove"),
    onclick: forget,
  });
  const stateRow = h("div", { class: "key-state-row" }, state, checkButton);
  const body = h(
    "div",
    { class: "vendor-body" },
    stateRow,
    checkResult,
    form,
    keyProblem,
    keyNote,
    h("p", { class: "links" }, keyPage, replaceButton, forgetButton),
  );
  const list = h("div", { class: "vendor-list", role: "radiogroup", "aria-label": label });
  container.replaceChildren(list);

  /** 显示一句话：msg 按界面语言翻，现成的字照写；空的就藏起来 */
  const show = (node, message) => {
    node.textContent = t.text(message);
    node.hidden = !message;
  };
  show(keyProblem, null);
  show(keyNote, null);

  const nameOf = (id) => t(`providers.${id}.name`);

  /** 几家变了（换了方式）才重建各行 */
  function buildRows(ids) {
    if (ids.join() === [...rows.keys()].join()) return;
    rows.clear();
    list.replaceChildren(
      ...ids.map((id) => {
        const keyState = h("span", { class: "vendor-key" });
        const head = h(
          "button",
          {
            type: "button",
            class: "vendor-head",
            role: "radio",
            onclick: () => choose(id),
          },
          h("span", { class: "logo-tile" }, providerIcon(id) ?? svg("i-cloud")),
          h("span", { class: "vendor-name", text: nameOf(id) }),
          keyState,
          h("span", { class: "radio-mark" }, svg("i-check")),
        );
        const row = h("div", { class: "vendor" }, head);
        rows.set(id, { row, head, keyState });
        return row;
      }),
    );
  }

  function choose(id) {
    if (id === picked()) return;
    replacing = false;
    input.value = "";
    show(keyProblem, null);
    show(keyNote, null);
    pick(id);
    // 点选了一家：有 key 就当场查一次它现在能不能用
    if (hasKey(latest, id)) check();
  }

  /** 查一次选中的那家：拿它的 key 发一个最小的请求，不换掉正在用的 */
  async function check() {
    const id = picked();
    const ticket = {};
    checks.set(id, { tone: "pending", text: t("keyPanel.check.running"), ticket });
    render(latest);
    let result;
    try {
      result = await window.speakmore.checkModel(mode, checkChanges(id));
    } catch (error) {
      result = { ok: false, problem: t("keyPanel.failed", { reason: describeError(error) }) };
    }
    if (checks.get(id)?.ticket !== ticket) return;
    checks.set(
      id,
      result.ok
        ? { tone: "ok", text: t("keyPanel.check.ok"), ticket }
        : { tone: "problem", text: t("keyPanel.check.failed", { problem: t.text(result.problem) }), ticket },
    );
    render(latest);
  }

  function render(setup) {
    latest = setup;
    const all = vendors(setup);
    buildRows(all.map(({ id }) => id));
    const vendor = all.find(({ id }) => id === picked()) ?? all[0];
    const name = nameOf(vendor.id);
    // 服务手里正拿着它的 key（正在用的方式要的就是它）：说那把 key 的状态；别的只说有没有
    const holding = vendor.id === setup.provider?.id;
    for (const [id, { row, head, keyState }] of rows) {
      const selected = id === vendor.id;
      head.setAttribute("aria-checked", String(selected));
      row.toggleAttribute("data-open", selected);
      const keyed = hasKey(setup, id);
      keyState.textContent = t(keyed ? "plaza.keys.stored" : "plaza.keys.none");
      keyState.dataset.tone = keyed ? "ok" : "";
    }
    // 只在换了一家时挪：挪动会让输入框丢掉焦点
    const { row } = rows.get(vendor.id);
    if (body.parentNode !== row) row.append(body);

    input.setAttribute("aria-label", t("plaza.keys.label", { platform: name }));
    input.placeholder = t("plaza.keys.placeholder", { platform: name });
    keyPage.hidden = !vendor.hasKeyPage;
    // 行头已经写着配没配：展开的这一行只在多说了点什么时出来（被拒了、在验证、来自环境变量）
    const said = holding ? keyText(setup.key, { ...vendor, name }) : otherKeyText(vendor);
    state.hidden = said === null;
    state.textContent = said?.[0] ?? "";
    state.dataset.tone = said?.[1] ?? "";
    // 环境变量和外部服务端的 key 不归这里管，不提供"删除"
    forgetButton.hidden = (holding ? setup.key.source : vendor.key) !== "stored";
    const editable = setup.key.source !== "external";
    // 有 key 的不摆输入框，点"更换"才出来；没有或者不能用的直接摆出来
    const keyed = hasKey(setup, vendor.id);
    form.hidden = !editable || (keyed && !replacing);
    replaceButton.hidden = !editable || !keyed;
    replaceButton.textContent = t(replacing ? "plaza.keys.cancel" : "plaza.keys.replace");
    input.disabled = !editable || saving;
    pasteButton.disabled = !editable || saving;
    saveButton.disabled = saving || !editable;
    // 检测：有 key 才能查；服务启动时正在验的那把等它验完
    const checked = checks.get(vendor.id);
    checkButton.hidden = !editable || !keyed;
    checkButton.disabled = saving || checked?.tone === "pending" || (holding && setup.key.state === "checking");
    checkResult.hidden = checkButton.hidden || !checked;
    stateRow.hidden = state.hidden && checkButton.hidden;
    checkResult.textContent = checked?.text ?? "";
    checkResult.dataset.tone = checked?.tone ?? "";
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const id = picked();
    const value = input.value;
    // 服务正拿着这家的 key：当场换上；别家的只存下（拿它自己的默认模型验过）
    const holding = id === latest.provider?.id;
    saving = true;
    saveButton.replaceChildren(svg("i-loader-circle", "icon spin"), t("keyPanel.verifying"));
    show(keyProblem, null);
    show(keyNote, null);
    render(latest);
    try {
      const result = await (holding ? window.speakmore.saveKey(value) : window.speakmore.saveKey(value, id, {}));
      if (result.ok) {
        input.value = "";
        replacing = false;
        // 换了 key：之前查的那次说的是旧的那把
        checks.delete(id);
        show(keyNote, result.note ?? null);
        onSaved();
      } else show(keyProblem, result.problem);
    } catch (error) {
      show(keyProblem, t("keyPanel.failed", { reason: describeError(error) }));
    } finally {
      saving = false;
      saveButton.replaceChildren(t("plaza.keys.save"));
      await refresh();
    }
  }

  async function paste() {
    const text = (await window.speakmore.readClipboard()).trim();
    if (text === "") {
      show(keyProblem, t("keyPanel.clipboardEmpty"));
      return;
    }
    show(keyProblem, null);
    input.value = text;
    input.focus();
  }

  async function forget() {
    const id = picked();
    const inUse = id === latest.provider?.id;
    const question = t(inUse ? "keyPanel.confirmForgetInUse" : "keyPanel.confirmForget", { provider: nameOf(id) });
    if (!window.confirm(question)) return;
    await window.speakmore.forgetKey(id);
    checks.delete(id);
    replacing = false;
    await refresh();
  }

  function toggleReplace() {
    replacing = !replacing;
    input.value = "";
    show(keyProblem, null);
    render(latest);
    if (replacing) input.focus();
  }

  return { render };
}
