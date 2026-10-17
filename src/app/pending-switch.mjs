import { findModel } from "../models/catalog.mjs";
import { MODES } from "../server/modes.mjs";

// 首次引导里选好了一种识别方式、只差本机模型还在下（renderer/onboarding/plan.mjs 的 waitingDownload）：
// 引导窗口开着时由引导自己等、自己切，当场说结果；窗口关了（走完、跳过、点了关闭）由这里接着等，下好了切过去。
// 用户之后自己换了方式、换了模型，这一套就作罢：以用户后来的选择为准。

/**
 * @param {object} options
 * @param {(id: string) => boolean} options.isInstalled 本机模型下好了没有（models/library.mjs）
 * @param {(mode: string, changes: object) => Promise<{ ok: boolean, problem?: object }>} options.switchMode
 *   app/modes.mjs 的 switchMode：验过才换
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 */
export function createPendingSwitch({ isInstalled, switchMode, log }) {
  /** 等着的那一套：{ mode, changes, model }；没有是 null */
  let waiting = null;

  return {
    /**
     * 记下要等的那一套，null 是不等了。页面传来的，先查一遍
     * @param {{ mode: string, changes: Record<string, string>, model: string } | null} way
     */
    set(way) {
      if (way !== null) {
        const valid =
          MODES.some(({ id }) => id === way?.mode) &&
          findModel(way.model) !== null &&
          typeof way.changes === "object" &&
          way.changes !== null &&
          Object.values(way.changes).every((value) => typeof value === "string");
        if (!valid) throw new TypeError("要等的识别方式写得不对");
      }
      if (JSON.stringify(way) !== JSON.stringify(waiting)) log.info("pending_switch_set", { way });
      waiting = way;
    },

    /** 用户自己换了方式或模型：以他的为准 */
    cancel() {
      if (waiting === null) return;
      log.info("pending_switch_cancelled", { way: waiting });
      waiting = null;
    },

    /** 本机模型的状态变了（或者引导窗口关了）：等的那个下好了就切过去 */
    async check() {
      if (waiting === null || !isInstalled(waiting.model)) return;
      const way = waiting;
      waiting = null;
      let result;
      try {
        result = await switchMode(way.mode, way.changes);
      } catch (error) {
        log.error("pending_switch_failed", { way, error: String(error?.stack ?? error) });
        return;
      }
      if (result.ok) log.info("pending_switch_done", { way });
      else log.warn("pending_switch_failed", { way, problem: result.problem });
    },
  };
}
