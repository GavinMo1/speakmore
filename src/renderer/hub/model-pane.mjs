import { backendText, measuredText, tagTexts } from "../../models/describe.mjs";
import { t } from "../shared/i18n.mjs";
import { createKeyPanel, KEY_LAYERS } from "../shared/key-panel.mjs";
import { describeError } from "../shared/setup-text.mjs";

// 设置里"模型"那一页：先选识别模式，再在模式里选模型。两种模式要选的东西不一样，各画各的：
//   native  一跳：收音频的那几家（key 面板，KEY_LAYERS.native）
//   local   两跳：第一跳是本机转写模型（列表、下载进度、下载源），第二跳是润色的那几家（key 面板，连同模型和地址）
// 上面的标签只是切换看哪一种；真要换模式按"改用"，验证过才换（内核 app/modes.mjs 的状态机）。
// 不在用的那种模式里也能先看、先填 key：第二跳的那家没有 key 就进不去 local，所以 key 要能先存。
// 那种模式里的模型只能在那种模式里当场换；没在用时点选的第一跳模型先记着，改用这种模式时一起带过去。

const $ = (id) => document.getElementById(id);

const megabytes = (bytes) => `${Math.round(bytes / 1_000_000)} MB`;

/** 显示一句话：msg 按界面语言翻，现成的字照写；空的就藏起来 */
function show(node, message, tone = "") {
  node.textContent = t.text(message);
  node.dataset.tone = tone;
  node.hidden = !message;
}

/**
 * @param {{ refresh: () => Promise<object> }} options refresh：重新问主进程要一份状态，并让整个窗口跟着更新
 */
export function createModelPane({ refresh }) {
  /** 最近一次拿到的状态 */
  let latest = null;
  /** 正在看哪种模式；第一次画时是正在用的那种 */
  let view = null;
  /** 没在 local 模式时点选的第一跳模型，改用 local 时一起带过去 */
  let pendingTranscriber = null;
  /** 第二跳的面板正看着哪家；模型、地址那一格按它画 */
  let polishVendor = null;
  /** 模型、地址那一格是为哪家填的初值：换了一家才重新填，免得刷新时把正在打的字盖掉 */
  let extraFor = null;
  /** 一次只做一件事（换模式、换模型），做的时候别的按钮不让点 */
  let busy = false;

  const nativePanel = createKeyPanel($("key-panel"), { refresh, layer: KEY_LAYERS.native });
  const polishPanel = createKeyPanel($("polish-panel"), {
    refresh,
    layer: KEY_LAYERS.polish({ polish: polishChoice, customUrl: customUrlChoice }),
    onSelect: (id) => {
      polishVendor = id;
      renderPolishExtra();
    },
  });
  polishPanel.slot.append($("polish-extra"));

  /** 改用某家润色时写成什么：那一家有几个模型就用选的那个，自定义服务用填的模型名 */
  function polishChoice(id) {
    if (id === "custom") return `custom/${$("custom-model").value.trim()}`;
    const vendor = latest.local.vendors.find((found) => found.id === id);
    return vendor.models.length > 1 ? `${id}/${$("polish-model").value}` : id;
  }

  /** 自定义服务的地址：只有改用自定义服务时才带 */
  function customUrlChoice() {
    return polishVendor === "custom" ? $("custom-url").value.trim() : undefined;
  }

  /** 做一件会改设置的事：结果里的问题、交代显示在这一页上，做完刷新 */
  async function act(action, problemNode = $("mode-problem")) {
    if (busy) return;
    busy = true;
    show($("mode-problem"), null);
    show($("local-problem"), null);
    show($("mode-note"), null);
    render(latest);
    try {
      const result = await action();
      if (!result.ok && result.problem) show(problemNode, result.problem, "problem");
      else if (result.note) show($("mode-note"), result.note);
    } catch (error) {
      show(problemNode, t("keyPanel.failed", { reason: describeError(error) }), "problem");
    } finally {
      busy = false;
      await refresh();
    }
  }

  // ---------- 模式 ----------

  for (const tab of document.querySelectorAll(".mode-tab")) {
    tab.addEventListener("click", () => {
      view = tab.dataset.mode;
      show($("mode-problem"), null);
      render(latest);
    });
  }

  $("use-mode").addEventListener("click", () => {
    const changes = {};
    if (view === "local" && pendingTranscriber && pendingTranscriber !== latest.local.transcriber) {
      changes.transcriber = pendingTranscriber;
    }
    act(async () => {
      const result = await window.speakmore.setMode(view, changes);
      if (result.ok) pendingTranscriber = null;
      return result;
    });
  });

  function renderModes(setup) {
    const current = setup.mode.value;
    for (const tab of document.querySelectorAll(".mode-tab")) {
      tab.setAttribute("aria-selected", String(tab.dataset.mode === view));
      tab.querySelector(".mode-live").hidden = tab.dataset.mode !== current;
    }
    $("mode-hint").textContent = t(`preferences.modes.${view}Hint`);
    $("mode-in-use").hidden = view !== current;
    // 连着单独启动的服务端时用哪种模式由那边定
    $("use-mode").hidden = view === current || !setup.switchable;
    $("use-mode").disabled = busy;
    $("use-mode").textContent = t("preferences.modes.use", { mode: t(`preferences.modes.${view}`) });
    $("mode-native").hidden = view !== "native";
    $("mode-local").hidden = view !== "local";
  }

  // ---------- local 第一跳：本机转写模型 ----------

  /** 正在用的那个本地模型现在怎样（只有 local 模式里有）：[说什么, 语气] */
  function localStateText(model, setup) {
    const local = setup.localModel;
    if (setup.mode.value === "local" && local && local.model === model.id) {
      switch (local.state) {
        case "downloading":
          return [
            t("preferences.local.downloading", {
              percent: Math.floor((local.received / local.total) * 100),
              size: `${megabytes(local.received)} / ${megabytes(local.total)}`,
            }),
            "pending",
          ];
        case "loading":
          return [t("preferences.local.loading"), "pending"];
        case "ready":
          return [t("preferences.local.ready", { backend: backendText(local.backend) }), "ok"];
        case "failed":
          return [t("preferences.local.failed"), "problem"];
      }
    }
    return model.installed ? [t("preferences.local.downloaded"), ""] : [megabytes(model.bytes), ""];
  }

  function renderTranscribers(setup) {
    const local = setup.local;
    const chosen = setup.mode.value === "local" ? local.transcriber : (pendingTranscriber ?? local.transcriber);
    $("transcribers").replaceChildren(
      ...local.transcribers.map((model) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "transcriber";
        row.setAttribute("role", "radio");
        row.setAttribute("aria-checked", String(model.id === chosen));
        row.disabled = busy || !setup.switchable;
        const name = document.createElement("span");
        name.className = "transcriber-name";
        name.textContent = model.name;
        const [text, tone] = localStateText(model, setup);
        const state = document.createElement("span");
        state.className = "transcriber-state";
        state.dataset.tone = tone;
        state.textContent = text;
        const tags = document.createElement("span");
        tags.className = "tags";
        tags.append(
          ...tagTexts(model.tags).map((tag) => {
            const chip = document.createElement("span");
            chip.className = "tag";
            chip.textContent = t.text(tag);
            return chip;
          }),
        );
        const measured = document.createElement("span");
        measured.className = "transcriber-measured";
        measured.textContent = t.text(measuredText(model.measured, local.chip));
        row.append(name, state, tags, measured);
        row.addEventListener("click", () => chooseTranscriber(model.id));
        return row;
      }),
    );
    // 正在用的那个没装上：说原因，给一个重试（再选一次同一个就是重试）
    const failed = setup.mode.value === "local" && setup.localModel?.state === "failed";
    $("transcriber-retry").hidden = !failed;
    $("transcriber-retry").disabled = busy;
    show($("transcriber-problem"), failed ? setup.localModel.problem : null, "problem");
  }

  function chooseTranscriber(id) {
    if (latest.mode.value !== "local") {
      // 没在 local 模式：先记着，改用 local 时一起带过去
      pendingTranscriber = id;
      render(latest);
      return;
    }
    if (id === latest.local.transcriber && latest.localModel?.state !== "failed") return;
    act(() => window.speakmore.setTranscriber(id), $("local-problem"));
  }

  $("transcriber-retry").addEventListener("click", () =>
    act(() => window.speakmore.setTranscriber(latest.local.transcriber), $("local-problem")),
  );

  function renderSource(setup) {
    const { value, choices } = setup.local.source;
    $("model-source").replaceChildren(
      ...choices.map((id) => new Option(t(`modelSources.${id}`), id, false, id === value)),
    );
    $("model-source").disabled = busy || !setup.switchable;
  }

  $("model-source").addEventListener("change", async (event) => {
    show($("source-note"), null);
    try {
      const result = await window.speakmore.setModelSource(event.target.value);
      show($("source-note"), result.note ?? null);
    } catch (error) {
      show($("source-note"), t("keyPanel.failed", { reason: describeError(error) }), "problem");
    }
    await refresh();
  });

  // ---------- local 第二跳：润色的模型和地址 ----------

  /** 面板看着的那家要另填的：有几个模型就给个下拉，自定义服务填模型名和地址 */
  function renderPolishExtra() {
    if (latest === null || polishVendor === null) return;
    const vendor = latest.local.vendors.find(({ id }) => id === polishVendor);
    const [chosenVendor, chosenModel] = latest.local.polish.split("/");
    const isChosen = polishVendor === chosenVendor;
    const many = vendor.models.length > 1;
    const custom = vendor.id === "custom";
    $("polish-model-row").hidden = !many;
    $("custom-fields").hidden = !custom;
    if (extraFor !== polishVendor) {
      extraFor = polishVendor;
      if (many) {
        const selected = isChosen ? chosenModel : vendor.defaultModel;
        $("polish-model").replaceChildren(
          ...vendor.models.map((model) => new Option(model, model, false, model === selected)),
        );
      }
      if (custom) {
        $("custom-model").value = isChosen ? chosenModel : "";
        $("custom-url").value = latest.local.customUrl;
      }
    }
    // 选的就是这家、正在 local 里：改了模型、地址按这个当场换（别家的由面板上的"改用"一起带过去）
    const live = isChosen && latest.mode.value === "local" && latest.switchable;
    $("polish-model").disabled = busy;
    $("apply-custom").hidden = !(custom && live);
    $("apply-custom").disabled = busy;
  }

  $("polish-model").addEventListener("change", () => {
    const [chosenVendor] = latest.local.polish.split("/");
    if (polishVendor !== chosenVendor || latest.mode.value !== "local") return;
    act(() => window.speakmore.setPolish(polishChoice(polishVendor)), $("local-problem"));
  });

  $("apply-custom").addEventListener("click", () =>
    act(() => window.speakmore.setPolish(polishChoice("custom"), customUrlChoice()), $("local-problem")),
  );

  // ---------- 画 ----------

  function render(setup) {
    latest = setup;
    if (view === null) view = setup.mode.value;
    // 已经在用了：没切过去之前记着的第一跳不要了
    if (setup.mode.value === "local") pendingTranscriber = null;
    renderModes(setup);
    nativePanel.render(setup);
    renderTranscribers(setup);
    renderSource(setup);
    polishPanel.render(setup);
  }

  return {
    render,
    /** 打开设置时回到正在用的那种模式 */
    reset() {
      view = null;
    },
  };
}
