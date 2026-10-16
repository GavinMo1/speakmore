import { msg, problemOf } from "../i18n/index.mjs";
import { findChatVendor } from "../server/chat/vendors.mjs";
import { describeRoute } from "../server/modes.mjs";
import { findProvider } from "../server/providers/index.mjs";
import { overridingEnv, patchSettings, resolveSettings, routeOf, saveSetting } from "../storage/settings.mjs";

// 识别模式：先选模式，再在模式里选模型。两种模式要选的东西不一样，各走各的路，不混在一起：
//   模式这一层       switchMode       native ↔ local：验证新模式要的那家的 key，通过了才换
//   native 这一层    setModel         收音频的厂商和模型（Gemini、OpenAI）：验证那家的 key
//   local 第一跳     setTranscriber   本机的转写模型：不用 key，服务在后台下载、装载
//   local 第二跳     setPolish        润色的厂商和模型（自定义服务连同地址）：验证那家的 key
// 改的是没在用的那种模式：只存下来，切过去时才用上，正在跑的不动。
// 每一步都先按改后的设置拼出路线（storage/settings.mjs 的 routeOf），验证过了才写设置；没通过什么都不变。
// 换路线、验证 key 是 key 管理（keys/key-manager.mjs 的 use）那一处的事，这里只管拼出该换成哪条。

/**
 * @param {object} options
 * @param {{ route: object, switchTranscriber(model: string): void }} options.service 内置的听写服务（service.mjs）
 * @param {{ use: Function, check: Function }} options.keys key 管理（keys/key-manager.mjs）
 * @param {string} options.settingsFile
 * @param {Record<string, string | undefined>} options.env
 * @param {{ info: Function }} options.log
 */
export function createModeSwitch({ service, keys, settingsFile, env, log }) {
  /** 一件一件来：前一件还在验证时又来一件，后一件要看到前一件存好的设置 */
  let queue = Promise.resolve();
  const serial = (task) => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  const read = () => resolveSettings({ file: settingsFile, env });

  /**
   * 写进设置文件。写不下去时这次运行照样换了，如实说下次启动不会记得；
   * 被环境变量盖着时说下次启动会被盖掉
   * @returns {{ note?: object }}
   */
  function save(changes) {
    for (const [name, value] of Object.entries(changes)) {
      try {
        saveSetting(settingsFile, name, value);
      } catch (error) {
        return { note: msg("notes.settingNotSaved", { name, reason: problemOf(error) }) };
      }
    }
    const variable = Object.keys(changes)
      .map((name) => overridingEnv(name, env))
      .find((found) => found !== null);
    return variable ? { note: msg("notes.envNextLaunch", { variable }) } : {};
  }

  /**
   * 某一种模式里的设置改了：是正在用的模式就按改后的设置换路线（apply 去换），否则只存。
   * @param {string} mode 改的是哪种模式的设置
   * @param {Record<string, string>} changes
   * @param {(route: object) => Promise<{ ok: boolean, problem?: object }>} apply
   */
  function change(mode, changes, apply) {
    return serial(async () => {
      let route;
      try {
        route = routeOf(patchSettings(read(), changes), mode);
      } catch (error) {
        return { ok: false, problem: problemOf(error) };
      }
      if (service.route.mode !== mode) {
        log.info("mode_setting_saved", { mode, settings: Object.keys(changes) });
        return { ok: true, applied: "later", ...save(changes) };
      }
      const result = await apply(route);
      if (!result.ok) return result;
      log.info("route_changed", { route: describeRoute(route), settings: Object.keys(changes) });
      return { ok: true, applied: "now", ...save(changes) };
    });
  }

  /** 换成这条路线，要的那家的 key 验证过才换 */
  const useRoute = (route) => keys.use({ route });

  return {
    /** 模式这一层：换成另一种模式，路线照那种模式自己的设置拼 */
    switchMode(mode) {
      return serial(async () => {
        let next;
        try {
          next = patchSettings(read(), { mode });
        } catch (error) {
          return { ok: false, problem: problemOf(error) };
        }
        const wanted = next.mode.value;
        const from = service.route.mode;
        if (from === wanted) return { ok: true, applied: "now", ...save({ mode: wanted }) };
        const result = await useRoute(routeOf(next, wanted));
        if (!result.ok) return result;
        log.info("mode_switched", { from, to: wanted });
        return { ok: true, applied: "now", ...save({ mode: wanted }) };
      });
    },

    /** native 这一层：收音频的厂商和模型，写法同设置里的 model（厂商、厂商/模型） */
    setModel(model) {
      return change("native", { model }, useRoute);
    },

    /** local 第一跳：本机的转写模型。不用 key：润色那一跳照旧，服务只换模型 */
    setTranscriber(transcriber) {
      return change("local", { transcriber }, async (route) => {
        service.switchTranscriber(route.transcriber);
        return { ok: true };
      });
    },

    /**
     * local 第二跳：润色的厂商和模型，写法同设置里的 polish（厂商、厂商/模型、custom/模型名）。
     * @param {string} polish
     * @param {{ customUrl?: string }} [options] 自定义服务的地址，和模型一起验证、一起存
     */
    setPolish(polish, { customUrl } = {}) {
      return change("local", customUrl === undefined ? { polish } : { polish, customUrl }, useRoute);
    },

    /**
     * 某一种模式按改后的设置能不能用：拼出路线交给 key 管理去试，不换掉正在用的
     * @returns {Promise<object>} 同 key-manager 的 check
     */
    async check(mode, changes) {
      let route;
      try {
        route = routeOf(patchSettings(read(), changes), mode);
      } catch (error) {
        return { ok: false, cause: "other", problem: problemOf(error) };
      }
      return keys.check(route);
    },

    /**
     * 给某一家存 key 前拿哪条路线验证：收音频的那家走 native、润色的那家走 local（key-manager 的 routeFor）。
     * 设置里已经选了这家就用设置里的模型，否则用它的默认模型；changes 是要一起换成的（还没存的）设置。
     * 自定义服务没有默认模型：没选过它、changes 里也没给时抛错，说要写成 custom/模型名
     */
    routeForVendor(id, changes = {}) {
      const settings = read();
      if (findProvider(id)) {
        const chosen = routeOf(settings, "native").model.provider === id;
        return routeOf(patchSettings(settings, { model: chosen ? settings.model.value : id, ...changes }), "native");
      }
      if (!findChatVendor(id)) throw new Error(`不认识的厂商：${id}`);
      const chosen = routeOf(settings, "local").polish.vendor === id;
      return routeOf(patchSettings(settings, { polish: chosen ? settings.polish.value : id, ...changes }), "local");
    },
  };
}
