import { msg, problemOf } from "../../i18n/index.mjs";
import { apiKeyProblem } from "../../server/providers/index.mjs";
import { overridingEnv } from "../../storage/settings.mjs";

// 主窗口改划词翻译的设置：设置里的"译成"，引擎页"划词"那一段的换模型、检测、配自定义服务。
// 只碰划词自己的几项（lookup.*）和它自己的那把 key（lookupcustom-key.bin），和语音那边的设置、key 不相干（他定的）。
// 清单里厂商的 key 不在这里：同一家只有一把，和语音共用，在密钥面板存（app/keys/key-manager.mjs）。
// 换模型当场换上、不验（同语音那边：还差的照实写着）；自定义服务要先验再存，免得存一把用不了的 key。

/**
 * @param {object} deps
 * @param {{ check(changes?: object, options?: { apiKey?: string }): Promise<object> }} deps.engine app/lookup/engine.mjs
 * @param {() => object} deps.readSettings 现读设置（resolveSettings 的结果）
 * @param {(name: string, value: string) => { value: string }} deps.save 存一项（storage/settings.mjs 的 saveSetting）；写错了会抛错
 * @param {{ exists(): boolean, save(key: string): void, clear(): void }} deps.customKeys 划词自定义服务的 key（app/keys/key-store.mjs）
 * @param {string} deps.customKeyEnv 那把 key 的环境变量：有它时优先，存着的不用
 * @param {Record<string, string | undefined>} deps.env
 * @param {{ info: Function, warn: Function, error: Function }} deps.log
 */
export function createLookupSetup({ engine, readSettings, save, customKeys, customKeyEnv, env, log }) {
  const customKeySource = () => (env[customKeyEnv]?.trim() ? "env" : customKeys.exists() ? "stored" : null);

  /** 存好了：被环境变量盖着的说一句，去掉它才生效 */
  function saved(names, { keyTyped = false } = {}) {
    const variable =
      names.map((name) => overridingEnv(name, env)).find(Boolean) ??
      (keyTyped && customKeySource() === "env" ? customKeyEnv : null);
    return variable ? { ok: true, note: msg("notes.envRemove", { variable }) } : { ok: true };
  }

  /** 存一项：写错了（不认识的模型、语言）不存，照实说 */
  function saveOne(name, value) {
    try {
      const { value: stored } = save(name, value);
      log.info("lookup_setting_changed", { name, value: stored });
    } catch (error) {
      log.warn("lookup_setting_rejected", { name, error: String(error?.message ?? error) });
      return { ok: false, problem: problemOf(error) };
    }
    return saved([name]);
  }

  return {
    /** 引擎页、设置页画划词那几项要的 */
    describe() {
      const settings = readSettings();
      return {
        to: settings["lookup.to"].value,
        model: settings["lookup.model"].value,
        customUrl: settings["lookup.customUrl"].value,
        customParams: settings["lookup.customParams"].value,
        customKey: customKeySource(),
      };
    },

    /** 译成哪种（语言 id） */
    setTo: (language) => saveOne("lookup.to", language),

    /** 换成清单里的一个模型（厂商/模型）：当场换上，缺 key 照实写着 */
    use: (choice) => saveOne("lookup.model", choice),

    /** 检测：按设置（再换上 changes 那几项）发一个最小的请求 */
    check: (changes) => engine.check(changes ?? {}),

    /**
     * 配自定义服务并换成它：先拿填的 key（没填就用存着的）验一次，通过了再存 key、地址、模型名、参数
     * @param {{ apiKey?: string, url: string, model: string, params: string }} form
     */
    async saveCustom({ apiKey = "", url = "", model = "", params = "" }) {
      const typed = String(apiKey).trim();
      const name = String(model).trim();
      if (name === "") return { ok: false, problem: msg("plaza.custom.modelMissing") };
      if (typed !== "") {
        const shape = apiKeyProblem(typed);
        if (shape) return { ok: false, problem: shape };
      } else if (customKeySource() === null) return { ok: false, problem: msg("key.empty") };
      const changes = {
        "lookup.model": `custom/${name}`,
        "lookup.customUrl": String(url).trim(),
        "lookup.customParams": String(params).trim(),
      };
      const checked = await engine.check(changes, typed ? { apiKey: typed } : {});
      if (!checked.ok) return { ok: false, problem: checked.problem };
      if (typed) {
        try {
          customKeys.save(typed);
        } catch (error) {
          log.error("lookup_custom_key_save_failed", { error: String(error?.message ?? error) });
          return { ok: false, problem: msg("key.notSaved", { reason: problemOf(error) }) };
        }
      }
      for (const [setting, value] of Object.entries(changes)) save(setting, value);
      log.info("lookup_custom_saved", { model: name, key_changed: typed !== "", ms: checked.ms });
      return saved(Object.keys(changes), { keyTyped: typed !== "" });
    },

    /** 删掉划词自定义服务存着的 key */
    forgetCustomKey() {
      customKeys.clear();
      log.info("lookup_custom_key_removed", {});
      return { ok: true };
    },
  };
}
