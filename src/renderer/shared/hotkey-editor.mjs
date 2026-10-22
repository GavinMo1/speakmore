import { chordString, chordsText, chordText } from "../../hotkeys/chord.mjs";
import { h, svg } from "./dom.mjs";
import { t } from "./i18n.mjs";
import { keycapRow as keycaps } from "./keycaps.mjs";

// 快捷键编辑（docs/hotkey-research.md 5.6、D4），设置页和首次引导共用：动作目录里每个动作一行，每个组合一个胶囊框
// （点它换掉、× 删掉），"添加另一个"（至多 4 个），和默认不一样时"恢复默认"。
// 录键在主进程和小帮手那边：这里点了告诉主进程（recordHotkey），主进程经 onHotkeyRecording 报回现在按着什么、存没存上。
// 页面只画，不判断合不合规矩：存的时候主进程查，被拒了说原因，人直接重按。

/**
 * @param {HTMLElement} root 画在这里面
 * @param {{ onChanged: () => Promise<void>, savedNote?: string }} options onChanged：存好、删掉、恢复默认之后，让页面重新要一份状态；
 *   savedNote：存好以后那一行写什么（文案的名字），默认"已保存"
 */
export function createHotkeyEditor(root, { onChanged, savedNote = "hotkeyRecord.saved" }) {
  /** 主进程给的每个动作一行（setup:get 的 hotkeyActions） */
  let actions = [];
  let enabled = true;
  /** 正在录的那一处：{ action, index, codes, unknown, tooMany, reason }；没在录是 null */
  let recording = null;
  /** 每个动作下面那一行字：{ text, tone } */
  const notes = new Map();

  const say = (actionId, message, tone = "") => {
    if (message) notes.set(actionId, { text: t.text(message), tone });
    else notes.delete(actionId);
  };

  async function run(actionId, task) {
    say(actionId, null);
    try {
      const result = await task();
      if (result?.note) say(actionId, result.note);
    } catch (error) {
      say(actionId, error.message, "problem");
    }
    await onChanged();
  }

  function start(actionId, index) {
    if (!enabled) return;
    say(actionId, null);
    const action = actions.find((item) => item.id === actionId);
    recording = { action: actionId, index: index ?? action.chords.length, codes: [], unknown: false, tooMany: false };
    draw();
    window.speakmore.recordHotkey(actionId, index).catch((error) => {
      recording = null;
      say(actionId, error.message, "problem");
      draw();
    });
  }

  /** reason 记进日志（src/app/hotkey-recording.mjs 的 PAGE_REASONS） */
  function stop(reason) {
    if (recording === null) return;
    recording = null;
    window.speakmore.stopRecordingHotkey(reason);
    draw();
  }

  window.speakmore.onHotkeyRecording((payload) => {
    if (recording === null || payload.action !== recording.action) return;
    if (payload.state === "recording") {
      recording = {
        ...recording,
        codes: payload.codes,
        unknown: payload.unknown,
        tooMany: payload.tooMany,
        reason: null,
      };
    } else if (payload.state === "rejected") {
      recording = { ...recording, codes: payload.codes, unknown: false, tooMany: false, reason: payload.reason };
    } else if (payload.state === "saved") {
      recording = null;
      say(payload.action, payload.note ?? savedNote, payload.note ? "" : "ok");
      onChanged();
    } else {
      recording = null;
    }
    draw();
  });

  // 录着的时候点了别处：不录了（录键时按键被小帮手吞掉，点鼠标是还能用的出口）
  document.addEventListener("pointerdown", (event) => {
    if (recording !== null && !event.target.closest?.("[data-recording]")) stop("elsewhere");
  });

  /** 一个组合的框。index 是它在这个动作里排第几；录着的那个画实时按着的键 */
  function chordBox(action, codes, index) {
    const live = recording?.action === action.id && recording.index === index ? recording : null;
    const text = codes ? t.text(chordText(codes)) : "";
    const problem =
      codes && action.problems.find((item) => item.chord && chordString(item.chord) === chordString(codes));
    const removable = codes && !live && (action.clearable || action.chords.length > 1);
    let caps;
    if (live) {
      caps =
        live.codes.length > 0
          ? keycaps(live.codes)
          : [h("span", { class: "chord-prompt", text: t("hotkeyRecord.prompt") })];
      if (live.unknown) caps.push(h("kbd", { class: "keycap", text: "?" }));
    } else {
      caps = keycaps(codes);
    }
    return h(
      "span",
      {
        class: "chord",
        "data-recording": live ? "" : null,
        "data-tone": live?.reason || live?.tooMany ? "problem" : problem ? "problem" : null,
        title: problem ? t.text(problem.reason) : null,
      },
      h(
        "button",
        {
          type: "button",
          class: "chord-keys",
          disabled: !enabled && !live,
          "aria-label": live ? t("hotkeyRecord.prompt") : t("hotkeyRecord.change", { chord: text }),
          onclick: () => (live ? stop("reclick") : start(action.id, index)),
        },
        ...caps,
      ),
      removable
        ? h(
            "button",
            {
              type: "button",
              class: "chord-remove",
              disabled: !enabled,
              "aria-label": t("hotkeyRecord.remove", { chord: text }),
              onclick: () => run(action.id, () => window.speakmore.removeHotkey(action.id, index)),
            },
            svg("i-close"),
          )
        : null,
    );
  }

  /** 这个动作下面那一行：录着时的提示和原因，存好、出错的结果，被环境变量盖着、装不上退回默认的 */
  function noteOf(action) {
    const live = recording?.action === action.id ? recording : null;
    if (live?.reason) return { text: t.text(live.reason), tone: "problem" };
    if (live?.tooMany) return { text: t("hotkeyRecord.tooMany"), tone: "problem" };
    if (live)
      return { text: t(action.when === "capturing" ? "hotkeyRecord.hintCapturing" : "hotkeyRecord.hint"), tone: "" };
    if (notes.has(action.id)) return notes.get(action.id);
    if (action.env) return { text: t("hotkeyRecord.envOverride", { variable: action.env }), tone: "" };
    const fallback = action.problems.find((item) => item.fallback);
    if (fallback) {
      return {
        text: t("hotkeyProblem.fallback", {
          action: t(`actions.${action.id}.name`),
          chord: chordsText(fallback.fallback),
        }),
        tone: "problem",
      };
    }
    return null;
  }

  function row(action) {
    const adding = recording?.action === action.id && recording.index >= action.chords.length;
    const isDefault =
      JSON.stringify(action.chords.map(chordString)) === JSON.stringify(action.defaults.map(chordString));
    const full = action.chords.length >= action.max;
    const note = noteOf(action);
    return h(
      "div",
      { class: "hotkey-row", "data-action": action.id },
      h(
        "div",
        { class: "hotkey-label" },
        h("span", { class: "hotkey-name", text: t(`actions.${action.id}.name`) }),
        h("span", { class: "hotkey-description", text: t(`actions.${action.id}.description`) }),
      ),
      h(
        "div",
        { class: "hotkey-chords" },
        ...action.chords.map((codes, index) => chordBox(action, codes, index)),
        adding ? chordBox(action, null, action.chords.length) : null,
        // 只在说话时生效的动作（取消）只认一个键，加了也是撞自己：不给加
        !adding && action.when !== "capturing"
          ? h(
              "button",
              {
                type: "button",
                class: "button small ghost hotkey-add",
                disabled: !enabled || full,
                title: full ? t("hotkeyRecord.limit", { count: action.max }) : null,
                onclick: () => start(action.id, null),
              },
              svg("i-plus"),
              t("hotkeyRecord.add"),
            )
          : null,
        isDefault
          ? null
          : h(
              "button",
              {
                type: "button",
                class: "button small ghost hotkey-reset",
                disabled: !enabled,
                onclick: () => run(action.id, () => window.speakmore.resetHotkey(action.id)),
              },
              t("hotkeyRecord.reset"),
            ),
      ),
      note ? h("p", { class: "hotkey-note", "data-tone": note.tone || null, role: "status", text: note.text }) : null,
    );
  }

  function draw() {
    root.replaceChildren(...actions.map(row));
    root.title = enabled ? "" : t("hotkeyRecord.needsListen");
  }

  return {
    /**
     * 按主进程给的状态重画
     * @param {object[]} hotkeyActions setup:get 的 hotkeyActions
     * @param {{ canRecord: boolean }} options canRecord：小帮手在跑、收得到按键（Mac 要输入监控权限）
     */
    render(hotkeyActions, { canRecord }) {
      actions = hotkeyActions;
      enabled = canRecord;
      if (!enabled && recording !== null) stop("unavailable");
      draw();
    },
    /** 直接开始给某个动作录（引导页的"换个键"）。index 同上 */
    record: start,
    /** 不录了（换页、收起时） */
    stop: () => stop("left"),
  };
}
