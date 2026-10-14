import { parseModelChoice } from "../../server/providers/index.mjs";
import { SETTINGS } from "../../storage/settings.mjs";
import { SOURCES } from "./settings.mjs";
import { displayWidth, INDENT, padEnd, paint } from "./text.mjs";

// 模型（speakmore model）：有哪几家、各用哪个模型、key 有没有、现在用的是哪个。

const KEY_STATES = {
  stored: () => "key 存着",
  env: (provider) => `key 来自环境变量 ${provider.keyEnv}`,
};

/**
 * @param {object} view
 * @param {ReadonlyArray<{ id: string, name: string, keyEnv: string, defaultModel: string }>} view.providers
 * @param {{ value: string, source: "env" | "file" | "default", env?: string }} view.setting 现在的 model 设置
 * @param {Record<string, "stored" | "env" | null>} view.keys 每家的 key 在哪：存着的、环境变量给的、没有
 * @param {{ color: boolean }} options
 */
export function renderModels({ providers, setting, keys }, { color }) {
  const c = paint(color);
  const current = parseModelChoice(setting.value);
  const rows = providers.map((provider) => {
    const inUse = provider.id === current.provider;
    return {
      provider,
      inUse,
      model: inUse ? current.model : `${provider.defaultModel}（默认）`,
      key: KEY_STATES[keys[provider.id]]?.(provider) ?? "还没有 key",
    };
  });
  const idWidth = Math.max(...providers.map(({ id }) => id.length)) + 3;
  const nameWidth = Math.max(...providers.map(({ name }) => displayWidth(name))) + 3;
  const modelWidth = Math.max(...rows.map(({ model }) => displayWidth(model))) + 3;

  const lines = ["模型", ""];
  for (const { provider, inUse, model, key } of rows) {
    const mark = inUse ? c.green("●") : " ";
    const keyText = keys[provider.id] ? key : c.dim(key);
    lines.push(
      `${INDENT}${mark} ${c.bold(padEnd(provider.id, idWidth))}${padEnd(provider.name, nameWidth)}${padEnd(model, modelWidth)}${keyText}`,
    );
  }
  const name = providers.find(({ id }) => id === current.provider).name;
  const other = providers.find(({ id }) => id !== current.provider) ?? providers[0];
  lines.push(
    "",
    `${INDENT}现在用的是 ${name} 的 ${current.model} · ${SOURCES[setting.source](SETTINGS.model, setting)}`,
    `${INDENT}换一家：speakmore model ${other.id}（还没有它的 key 会先问你要）`,
    `${INDENT}指定模型：speakmore model ${other.id}/${other.defaultModel}`,
    `${INDENT}看能不能用：speakmore model check（不写就查现在用的这个）`,
    "",
  );
  return lines.join("\n");
}
