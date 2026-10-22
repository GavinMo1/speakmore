import { textFromModelOutput } from "./output.mjs";
import { polishInput, polishPromptWith } from "./polish-prompt.mjs";
import { nativePromptWith, TASK_REMINDER } from "./prompt.mjs";

// 语音输入：他说什么，就写成他想打出来的那段字（删口头禅、改口，分段分点）。
// 三种识别方式都能做，各步用的提示词和收尾都在这个目录里，别的任务不引用这里的东西。

/** 成品只有一段字，没有另外要存的原文 */
const done = (text) => ({ text, source: null });

/** 直出：录音交给听音频的模型 */
const NATIVE = Object.freeze({
  system: (terms) => nativePromptWith(terms),
  reminder: TASK_REMINDER,
  finish: (output) => done(textFromModelOutput(output)),
});

/** 混合的整理那一步：转出来的文字交给文字模型 */
const POLISH = Object.freeze({
  system: (terms) => polishPromptWith(terms),
  input: polishInput,
  finish: (output) => done(textFromModelOutput(output)),
});

/** 离线：转出来的文字去掉首尾空白直接交出，不经任何模型 */
const TRANSCRIBE = Object.freeze({
  finish: (transcript) => done(transcript.trim()),
});

const DICTATION = Object.freeze({ id: "dictate", native: NATIVE, polish: POLISH, transcribe: TRANSCRIBE });

export const dictate = Object.freeze({
  id: "dictate",
  // 协议里的名字照原版（docs/04-voice-pipeline.md 的"模式"）：start_audio 写内部名，set_mode_config 写发给服务端的名字
  mode: "voice_transcript",
  configMode: "transcript",
  /** 要客户端在 set_mode_config 里给的参数：没有，开口就能定 */
  parameters: Object.freeze([]),
  /** 用词典：听写专有名词靠它 */
  vocabulary: true,
  steps: Object.freeze(["native", "polish", "transcribe"]),
  bind: () => DICTATION,
});
