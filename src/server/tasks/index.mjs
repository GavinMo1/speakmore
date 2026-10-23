import { dictate } from "./dictate/index.mjs";
import { translate } from "./translate/index.mjs";

// 任务：一次说话要做成什么。和识别方式（../modes.mjs）是两个维度，各管各的：
//   识别方式管"交给谁、怎么交"：直出把录音交给听音频的模型，混合先转文字再交给文字模型整理，离线只用本机模型转文字。
//   任务管"让模型做什么、成品怎么收"：提示词、发给模型的那条消息、模型回的话怎么变成成品。
// 每个任务一个目录，自己的提示词和收尾都放在里面，任务之间不互相引用；流水线（../refine）只认下面这个接口，
// 不认任务的名字。加一个任务只改两处：新建它的目录，在 TASKS 里加一行。
//
// 定义（TASKS 的一项）：
//   id          和动作目录（src/hotkeys/actions.mjs）的动作 id 一样
//   mode        start_audio 里的 mode（原版的内部名，voice_transcript 这样）
//   configMode  set_mode_config 里的 mode（原版发给服务端的名字，transcript 这样）
//   parameters  要客户端在 set_mode_config 里给的参数名；空的开口就能定
//   steps       能在哪几步上做：native（直出那一步）、polish（混合的整理那一步）、transcribe（离线只有转文字这一步）。
//               识别方式说自己的成品出在哪一步（../modes.mjs 的 step），不在这里的就是这种方式做不了
//   bind(params)  按参数定下这一次的做法：steps 里每一步一副，拿 bind 回的对象交给流水线
//
// 每一步的那一副：
//   native      { system(terms) → 系统提示词, reminder → 跟在录音后面的那句话, finish(output) → 成品 }
//   polish      { system(terms) → 系统提示词, input(transcript) → 用户消息, finish(output, transcript) → 成品 }
//   transcribe  { finish(transcript) → 成品 }
//   terms 是挑好的用户词典（vocabulary/support.mjs 的 fitTerms）；output 是模型回的原话。
// 成品都是 { text, source }：text 是要交出去的字，source 是另外要存的原文（翻译时他说的话），没有是 null。

export const TASKS = Object.freeze([dictate, translate]);

/** 这个 id 的任务；不认识的是 null */
export const findTask = (id) => TASKS.find((task) => task.id === id) ?? null;

/** start_audio 里的 mode 对应的任务；不认识的是 null */
export const taskOfMode = (mode) => TASKS.find((task) => task.mode === mode) ?? null;

/** set_mode_config 里的 mode 对应的任务；不认识的是 null */
export const taskOfConfigMode = (mode) => TASKS.find((task) => task.configMode === mode) ?? null;
