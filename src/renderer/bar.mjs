// 悬浮条：把按键事件喂给状态机，按状态机给出的动作去录音、上传、交付，并把状态画出来。

import { Action, initialState, LONG_PRESS_MS, Phase, transition } from "./machine.mjs";
import { startRecording } from "./recorder.mjs";
import { VoiceSocket } from "./voice-socket.mjs";

/** 原版的单次录音上限：9 分钟 */
const MAX_DURATION_MS = 540_000;
/** 回到空闲后，提示和报错在屏幕上留多久 */
const MESSAGE_LINGER_MS = 4_000;

const { serverUrl, hotkeyLabel } = await window.speakmore.config();
const voice = new VoiceSocket(serverUrl);

let state = initialState;
/** 正在进行的那一次：{ audioId, recording, cancelled } */
let session = null;
let holdTimer = null;
let maxDurationTimer = null;

function dispatch(event) {
  const result = transition(state, event);
  state = result.state;
  render();
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

const describe = (error) => (error instanceof Error ? error.message : String(error));

function start() {
  const current = { audioId: crypto.randomUUID(), recording: null, cancelled: false };
  session = current;
  (async () => {
    await voice.begin(current.audioId);
    const recording = await startRecording({
      onChunk: (chunk) => voice.sendChunk(chunk),
      onLevel: renderLevel,
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
  if (error?.name === "NotAllowedError") return "没有麦克风权限：到 系统设置 › 隐私与安全性 › 麦克风 里打开";
  if (error?.name === "NotFoundError") return "没有找到麦克风";
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
      throw new Error("麦克风没有信号：检查输入设备有没有选对、是不是被静音了");
    }
    const text = await voice.finish({ durationSeconds: recorded.durationSeconds });
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
    // 录音还在的话交给主进程存下来，失败了话也不会白说
    if (recorded) {
      await window.speakmore
        .reportFailure({
          audioId: current.audioId,
          error: message,
          durationSeconds: recorded.durationSeconds,
          audio: await recorded.blob.arrayBuffer(),
        })
        .catch((saveError) => console.error("失败记录没有存上", saveError));
    }
    dispatch({ type: "FAILED", message });
  }
}

// ---------- 画面 ----------

const label = document.getElementById("label");
const meter = document.getElementById("meter");
const LABELS = {
  [Phase.STARTING]: "正在打开麦克风",
  [Phase.RECORDING]: `正在听，再按一下${hotkeyLabel}结束`,
  [Phase.FINISHING]: "整理中",
};
let lingerTimer = null;

function render() {
  clearTimeout(lingerTimer);
  document.body.dataset.phase = state.phase;
  label.textContent = state.message ?? LABELS[state.phase] ?? "";
  if (state.phase !== Phase.RECORDING) renderLevel(0);

  const resting = state.phase === Phase.IDLE || state.phase === Phase.ERROR;
  window.speakmore.setBarVisible(!resting || state.message !== null);
  if (resting && state.message !== null) {
    lingerTimer = setTimeout(() => window.speakmore.setBarVisible(false), MESSAGE_LINGER_MS);
  }
}

function renderLevel(level) {
  // 说话的音量集中在低段，开方之后小声也看得出变化
  meter.style.setProperty("--level", Math.min(1, Math.sqrt(level)).toFixed(3));
}

// ---------- 来自主进程的事件 ----------

window.speakmore.onHotkey((event) => {
  if (event.event === "hotkey") dispatch({ type: event.down ? "KEY_DOWN" : "KEY_UP" });
  else if (event.event === "other_key") dispatch({ type: "OTHER_KEY" });
});

window.speakmore.onNotice((message) => {
  // 权限之类的提醒只在空闲时显示，不打断正在进行的听写
  if (state.phase !== Phase.IDLE && state.phase !== Phase.ERROR) return;
  state = { ...state, message };
  render();
});

render();
