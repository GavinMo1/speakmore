import { dictate } from "./dictate.mjs";
import { translate } from "./translate.mjs";

// 悬浮条上的功能：动作目录里每个录音会话的动作一项（handler 是 session 的）。悬浮条主逻辑（bar.mjs）只认下面这个接口，
// 不认功能的名字；加一个说话的功能就在这里加一个模块，和服务端的任务（src/server/tasks）一一对应。
//
//   id          动作的 id
//   mode        start_audio 里的模式名；configMode：set_mode_config 里的（照原版，和服务端的任务一样，有测试对着查）
//   open(config) → state     开口时这一次的状态。config 是主进程现读的设置（bar:session-config），改了设置下一次就生效
//   parameters(state)        set_mode_config 的参数；null 是不用发
//   chip(state)              提示行左边的胶囊：{ text, options: [{ id, text, selected }] }，没有是 null
//   pick(state, id) → state  在胶囊里选了一项
//   finishing                等成品时提示行写什么（一句 msg）；null 用默认的"整理中"
//   delivered(state, result) 交给主进程存历史的另外几项（result 是服务端回的 { text, source }）

export const FEATURES = Object.freeze([dictate, translate]);

/** 这个动作在悬浮条上的那一项；不是说话的动作（取消）、不认识的是 null */
export const featureOf = (action) => FEATURES.find((feature) => feature.id === action) ?? null;
