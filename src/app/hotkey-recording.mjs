import { actionOf } from "../hotkeys/actions.mjs";
import { isModifier } from "../hotkeys/keys.mjs";
import { createRecordRound } from "../hotkeys/record.mjs";
import { LocalizedError, msg } from "../i18n/index.mjs";

// 设置页、引导页录键（docs/hotkey-research.md 5.6）：页面说"给这个动作录一个"，这里让小帮手进录键模式，
// 它报的按住集合按 src/hotkeys/record.mjs 的规则定稿，修饰键加普通键的先问它有没有被系统或别的程序占了，
// 再交给保存（和命令行 config set 同一套校验），结果告诉那个页面。同一时刻只有一处在录：新的开始，旧的那处收到结束。
//
// 告诉页面的（payload.state）：
//   recording  还在录，codes 是现在按着的（unknown：有认不出的键，tooMany：超过两个了）
//   rejected   这一下不行，reason 说为什么；还在录，全部松开后可以直接重按
//   saved      存好了，退出录键；note 是能存但要提醒的话
//   ended      没录成就结束了，reason：cancelled（单按 esc）、blur（页面失焦或说不录了）、replaced（另一处开始录）、
//              timeout（小帮手 30 秒到点自己停了）、helper（小帮手不在了）

/** 一个错误里给人看的那句：设置校验的错包了一层"哪一项写的是什么"，录键时页面上看得到是哪个组合，只要最里面的原因 */
function reasonOf(error) {
  let reason = error instanceof LocalizedError ? error.problem : msg("hotkeyRecord.saveFailed");
  for (let cause = error?.cause; cause instanceof LocalizedError; cause = cause.cause) reason = cause.problem;
  return reason;
}

/**
 * @param {object} deps
 * @param {string} deps.platform
 * @param {(on: boolean) => void} deps.record 让小帮手进出录键模式
 * @param {(codes: string[]) => Promise<{ conflict: boolean, source?: string }>} deps.probe 问小帮手这个组合有没有被占
 * @param {(actionId: string) => string[][]} deps.chordsOf 这个动作现在设置里存的组合（要在它上面加、换）
 * @param {(actionId: string, chords: string[][]) => { note?: object }} deps.save 存（校验不过就抛）
 * @param {(target: unknown, payload: object) => void} deps.send 告诉发起的那个页面
 * @param {{ info: Function, warn: Function }} deps.log
 */
export function createHotkeyRecording({ platform, record, probe, chordsOf, save, send, log }) {
  /** @type {null | { target: unknown, action: object, index: number, round: object, armed: boolean }} */
  let session = null;
  /** 让小帮手停了、还没收到它 on:false 回执的次数：回执晚到时不能当成下一轮到点了 */
  let pendingOffs = 0;
  const leave = () => {
    pendingOffs += 1;
    record(false);
  };

  const tell = (current, payload) =>
    send(current.target, { action: current.action.id, index: current.index, ...payload });

  function end(reason, { quiet = false } = {}) {
    const current = session;
    if (current === null) return;
    session = null;
    if (!quiet) leave();
    log.info("hotkey_record_ended", { action: current.action.id, reason });
    tell(current, { state: "ended", reason });
  }

  async function settle(current, codes) {
    const chords = chordsOf(current.action.id).slice();
    chords.splice(current.index, 1, codes);
    if (codes.some(isModifier) && codes.some((code) => !isModifier(code))) {
      const found = await probe(codes);
      if (session !== current) return;
      if (found.conflict) {
        const reason = msg(found.source === "registered" ? "hotkeyRecord.appTaken" : "hotkeyRecord.systemTaken");
        log.info("hotkey_record_rejected", { action: current.action.id, chord: codes, source: found.source });
        tell(current, { state: "rejected", codes, reason });
        return;
      }
    }
    try {
      const { note } = save(current.action.id, chords);
      session = null;
      leave();
      log.info("hotkey_recorded", { action: current.action.id, index: current.index, chord: codes });
      tell(current, { state: "saved", ...(note ? { note } : {}) });
    } catch (error) {
      log.info("hotkey_record_rejected", { action: current.action.id, chord: codes, reason: error.message });
      tell(current, { state: "rejected", codes, reason: reasonOf(error) });
    }
  }

  return {
    /**
     * 开始给某个动作录
     * @param {unknown} target 发起的页面（webContents），结果只告诉它
     * @param {string} actionId
     * @param {number | null} index 换掉第几个组合；null 是加一个
     */
    start(target, actionId, index) {
      const action = actionOf(actionId);
      if (action === null) throw new TypeError(`不认识的动作：${actionId}`);
      // 另一处在录：告诉它结束，但不让小帮手停——再发一次 on:true 它会从头录。先停再开的话，停的那条回执晚到，
      // 会被当成这一轮到点了
      if (session !== null) end("replaced", { quiet: true });
      const count = chordsOf(action.id).length;
      session = {
        target,
        action,
        index: index === null || index === undefined || index >= count ? count : index,
        round: createRecordRound({ platform, cancelable: action.when !== "capturing" }),
        // 小帮手进录键模式时先报一份空的；那之前到的是上一轮晚到的快照，不算
        armed: false,
      };
      record(true);
      log.info("hotkey_record_started", { action: action.id, index: session.index });
    },

    /** 页面说不录了（失焦、点了别处、关了）。不是在录的那一处说的不算 */
    stop(target, reason = "blur") {
      if (session?.target === target) end(reason);
    },

    /** 这个页面是不是正在录：它的窗口这时要拦住按键，免得 ⌘W 之类作用在窗口上 */
    recordingFor: (target) => session?.target === target,

    /** 小帮手报的 recording 事件 */
    onRecording(event) {
      if (event.on === false) {
        // 自己让停的回执：认掉。剩下的是小帮手自己停的（30 秒到点）
        if (pendingOffs > 0) pendingOffs -= 1;
        else end("timeout", { quiet: true });
        return;
      }
      const current = session;
      if (current === null) return;
      const empty = (event.mods?.length ?? 0) + (event.keys?.length ?? 0) === 0;
      if (!current.armed) {
        if (!empty) return;
        current.armed = true;
      }
      const { codes, unknown, tooMany, result } = current.round.feed(event);
      tell(current, { state: "recording", codes, unknown, tooMany });
      if (result === null) return;
      if (result.cancel) end("cancelled");
      else if (result.error) tell(current, { state: "rejected", codes, reason: result.error });
      else
        settle(current, result.codes).catch((error) => {
          log.warn("hotkey_record_failed", { action: current.action.id, error: String(error) });
          if (session === current) tell(current, { state: "rejected", codes: result.codes, reason: reasonOf(error) });
        });
    },

    /** 小帮手退出了：在录的那一处收到结束 */
    helperGone() {
      pendingOffs = 0;
      end("helper", { quiet: true });
    },
  };
}
