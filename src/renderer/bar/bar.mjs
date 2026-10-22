// 悬浮条：把按键和点击喂给状态机，按状态机给出的动作去录音、上传、交付。
// 画面不在这里：该是什么样子由 bar-view.mjs 算，画出来由 bar-ui.mjs 管。

import { chordKeycaps } from "../../hotkeys/chord.mjs";
import { LocalizedError, msg, problemOf } from "../../i18n/index.mjs";
import { localize, setLocale, t } from "../shared/i18n.mjs";
import { createBarUi } from "./bar-ui.mjs";
import { viewOf } from "./bar-view.mjs";
import { Action, eventTypeOf, initialState, LONG_PRESS_MS, Phase, transition } from "./machine.mjs";
import { startRecording } from "./recorder.mjs";
import { VoiceSocket } from "./voice-socket.mjs";

/** 原版的单次录音上限：9 分钟 */
const MAX_DURATION_MS = 540_000;

// 页面的 lang 跟着界面语言：提示是 aria-live 的，读屏软件按它挑用哪种语言念
localize();
const { serverUrl, hotkeys: initialHotkeys, barControls, barHint } = await window.speakmore.config();
/** 现在每个动作的热键（组合列表）。提示里写听写、取消的键帽，按界面语言写 */
let hotkeys = initialHotkeys;
/** 这一次是按听写的第几个组合开始的：几个组合都能结束，提示里写按下的那个，不容易看糊涂 */
let dictateChord = 0;
const keycapsOf = (codes) => (codes ? chordKeycaps(codes).map((cap) => t.text(cap)) : []);
const hintKeys = () => ({
  keys: keycapsOf(hotkeys.dictate[dictateChord] ?? hotkeys.dictate[0]),
  escKeys: keycapsOf(hotkeys.cancel?.[0]),
});
const voice = new VoiceSocket(serverUrl);
const ui = createBarUi({
  document,
  host: { setVisible: window.speakmore.setBarVisible, capture: window.speakmore.captureBarInput },
  keys: hintKeys(),
  t,
});
ui.setControls(barControls);
ui.setHintShown(barHint === "on");
window.speakmore.onBarHint((value) => ui.setHintShown(value === "on"));
window.speakmore.onHotkeysChanged((next) => {
  hotkeys = next;
  dictateChord = 0;
  ui.setKeys(hintKeys());
});
// 设置里换了语言：悬浮条不重新加载（可能正在听写），换掉翻译，下一句就是新的语言
window.speakmore.onLocaleChanged((locale) => {
  setLocale(locale);
  ui.setKeys(hintKeys());
  ui.setTranslator(t, t.text(state.message));
});

let state = initialState;
/** 正在进行的那一次：{ audioId, recording, cancelled } */
let session = null;
let holdTimer = null;
let maxDurationTimer = null;

function dispatch(event) {
  const previous = state;
  const result = transition(state, event);
  state = result.state;
  // 状态没动（比如空闲时松开热键）就不重画
  if (state !== previous) ui.show(viewOf(state, previous.phase), t.text(state.message));
  for (const action of result.actions) ACTIONS[action]();
}

const ACTIONS = {
  [Action.START]: start,
  [Action.CANCEL]: cancel,
  [Action.STOP]: stop,
  [Action.ARM_HOLD_TIMER]: () => {
    holdTimer = setTimeout(() => dispatch({ type: "LONG_HOLD" }), LONG_PRESS_MS);
  },
  [Action.CLEAR_HOLD_TIMER]: () => clearTimeout(holdTimer),
};

/** 一个错误给人看的那句话：一句 msg（到画出来时才按界面语言翻），或者现成的字 */
const describe = problemOf;

function start() {
  const current = { audioId: crypto.randomUUID(), recording: null, cancelled: false };
  session = current;
  (async () => {
    await voice.begin(current.audioId);
    const recording = await startRecording({
      onChunk: (chunk) => voice.sendChunk(chunk),
      onLevel: ui.level,
      onError: (error) => dispatch({ type: "FAILED", message: describe(error) }),
    });
    // 等麦克风的这一小段时间里用户可能已经取消了
    if (current.cancelled) {
      recording.cancel();
      return;
    }
    current.recording = recording;
    maxDurationTimer = setTimeout(() => dispatch({ type: "MAX_DURATION" }), MAX_DURATION_MS);
    dispatch({ type: "MIC_READY" });
  })().catch((error) => {
    console.error("开始录音失败", error);
    if (!current.cancelled) dispatch({ type: "FAILED", message: describeStartError(error) });
  });
}

function describeStartError(error) {
  if (error?.name === "NotAllowedError") return msg("bar.noMicPermission");
  if (error?.name === "NotFoundError") return msg("bar.noMicrophone");
  return describe(error);
}

function cancel() {
  clearTimeout(maxDurationTimer);
  if (!session) return;
  session.cancelled = true;
  session.recording?.cancel();
  session = null;
  voice.abandon();
}

async function stop() {
  clearTimeout(maxDurationTimer);
  const current = session;
  session = null;
  let recorded = null;
  try {
    recorded = await current.recording.stop();
    if (!recorded.hadSignal) {
      voice.abandon();
      throw new LocalizedError(msg("bar.noSignal"));
    }
    const { onDemandModels } = await window.speakmore.config();
    const text = await voice.finish({
      durationSeconds: recorded.durationSeconds,
      ...(onDemandModels ? { timeoutMs: 120_000 } : {}),
    });
    const { notice } = await window.speakmore.deliver({
      audioId: current.audioId,
      text,
      durationSeconds: recorded.durationSeconds,
      audio: await recorded.blob.arrayBuffer(),
    });
    dispatch({ type: "RESULT", message: notice });
  } catch (error) {
    console.error("这次听写失败", error);
    const message = describe(error);
    // 录音还在的话交给主进程存下来，失败了话也不会白说。历史里记的是这一刻界面上的那句话
    if (recorded) {
      await window.speakmore
        .reportFailure({
          audioId: current.audioId,
          error: t.text(message),
          durationSeconds: recorded.durationSeconds,
          audio: await recorded.blob.arrayBuffer(),
        })
        .catch((saveError) => console.error("失败记录没有存上", saveError));
    }
    dispatch({ type: "FAILED", message });
  }
}

// ---------- 来自主进程的事件 ----------

window.speakmore.onInput((input) => {
  // 主进程带着是听写的第几个组合按下的（绑定 id 的序号）
  if (input.action === "dictate" && input.down && Number.isInteger(input.chord) && input.chord !== dictateChord) {
    dictateChord = input.chord;
    ui.setKeys(hintKeys());
  }
  const type = eventTypeOf(input);
  if (type === undefined) {
    console.warn("不认识的输入事件", input);
    return;
  }
  if (type !== null) dispatch({ type });
});

window.speakmore.onBarControls(ui.setControls);

window.speakmore.onNotice((message) => {
  // 权限之类的提醒只在空闲时显示，不打断正在进行的听写
  if (state.phase !== Phase.IDLE && state.phase !== Phase.ERROR) return;
  state = { ...state, message };
  ui.show(viewOf(state, state.phase), t.text(message));
});
