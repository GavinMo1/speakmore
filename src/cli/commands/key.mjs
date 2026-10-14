import { existsSync, rmSync } from "node:fs";
import { apiKeyProblem, findProvider, PROVIDERS, parseModelChoice } from "../../server/providers/index.mjs";
import { keyFile } from "../../storage/paths.mjs";
import { Cancelled } from "../ask-secret.mjs";
import { currentSettings, ensureRunning, parse, UsageError } from "../common.mjs";

// speakmore key：问 key、交给后台应用验证并保存、删掉。每家模型一把，不写厂商就是设置里正在用的那家。
// 启动时（speakmore start）和换模型时（speakmore model）缺 key 也从这里问。

const MAX_KEY_ATTEMPTS = 3;

/** 存 key 时后台应用要拿它去问一次那一家，那边的超时是 30 秒 */
const SAVE_KEY_TIMEOUT_MS = 45_000;

const KEY_PROMPT = "粘贴 key 后按回车（输入不会显示出来）：";

/**
 * 问 key 之前的那几句说明。它不单独打印，而是和提示一起交给 askSecret：
 * 那一步会先关掉终端的回显再显示文字。否则手快的人看到"要 key 了"就粘贴，
 * 而回显还没关，key 会被终端原样显示出来（在伪终端里实测到过）。
 */
const keyPreamble = (provider, skippable) =>
  [
    "",
    `需要一把 ${provider.name} API key：录音是发给 ${provider.name} 整理成文字的。`,
    `没有的话在这里申请一把：${provider.keyPage}`,
    "它会用系统钥匙串加密后存在这台电脑上，不会发到别处。",
    ...(skippable ? ["现在不想填就直接按回车。"] : []),
    KEY_PROMPT,
  ].join("\n");

/**
 * 在终端里一把一把地问某一家的 key：每调一次给出一把样子没问题的，样子不对的当场说、当场再问。
 * 前后一共最多问 MAX_KEY_ATTEMPTS 次。
 * @returns {() => Promise<string | null>} null：没填、按了 Ctrl-C，或者已经问够了次数
 */
export function keyPrompter(io, provider) {
  let asked = 0;
  return async function nextKey() {
    while (asked < MAX_KEY_ATTEMPTS) {
      let value;
      try {
        value = await io.askSecret(asked++ === 0 ? keyPreamble(provider, true) : KEY_PROMPT);
      } catch (error) {
        if (error instanceof Cancelled) return null;
        throw error;
      }
      if (value === "") return null;
      const problem = apiKeyProblem(value);
      if (problem === null) return value;
      io.err(`这把 key ${problem}。`);
    }
    return null;
  };
}

/** 把某一家的一把 key 交给后台应用验证并保存。@returns {Promise<boolean>} 通过了没有 */
export async function submitKey(io, value, provider) {
  io.out("正在验证…");
  const result = await io.daemon.request(
    "set-key",
    { key: value, provider: provider.id },
    { timeoutMs: SAVE_KEY_TIMEOUT_MS },
  );
  if (result.ok) io.out("key 已保存，验证通过。");
  else io.err(`这把 key 没有通过：${result.problem}`);
  return result.ok;
}

/** 设置里选的是哪一家 */
export const currentProvider = (io) => findProvider(parseModelChoice(currentSettings(io).model.value).provider);

/**
 * 不用启动后台就看得出某一家的 key 在哪：stored（存过）、env（环境变量给了），都没有是 null。
 * 看的是命令启动的那一份：装成应用的那个各存各的，从这里读不到它的状态
 */
export function keySource(io, provider) {
  if (io.env[provider.keyEnv]?.trim()) return "env";
  if (existsSync(keyFile(io.paths, provider.id))) return "stored";
  return null;
}

/** 启动之前就看得出有 key 可用：存过、环境变量给了，或者 key 归单独启动的服务端管 */
export const hasKeyAlready = (io) =>
  keySource(io, currentProvider(io)) !== null || Boolean(io.env.SPEAKMORE_SERVER_URL);

/**
 * 这种状态是不是填一把新的 key 就能解决。有两种不是：Gemini 拒绝了请求（多半是模型名或档位写错），
 * 和环境变量里的那把不对（存一把新的也没用，下次启动用的还是环境变量）。
 */
export const needsNewKey = (key) =>
  key.state === "missing" ||
  key.state === "unreadable" ||
  (key.state === "rejected" && key.cause !== "other" && key.source !== "env");

export async function key(args, io) {
  const { values, positionals } = parse(args, { forget: { type: "boolean", default: false } });
  // 后面可以写一个厂商名。别的东西多半就是一把 key：不照做，也不把它再打一遍
  const named = positionals.length === 1 ? findProvider(positionals[0]) : null;
  if (positionals.length > 0 && named === null) {
    throw new UsageError(
      `key 不要写在命令后面：那样它会留在 shell 的历史记录里。运行 speakmore key 再粘贴，或者从管道喂：pbpaste | speakmore key。` +
        `要给某一家填，后面写它的名字：${PROVIDERS.map(({ id }) => id).join(" / ")}`,
    );
  }
  const provider = named ?? currentProvider(io);

  if (values.forget) {
    // 在运行的话让它把手里的那把也放下；没在运行时不必为了删文件把它启动起来
    if ((await io.daemon.status()) !== null) await io.daemon.request("forget-key", { provider: provider.id });
    // 命令启动的和装成应用的各存各的一份，都删
    for (const packaged of [false, true]) rmSync(keyFile(io.paths, provider.id, { packaged }), { force: true });
    io.out(`存着的 ${provider.name} 的 key 已经删掉。`);
    return 0;
  }

  let value;
  try {
    value = await io.askSecret(keyPreamble(provider, false));
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    io.err("已取消，key 没有改动。");
    return 1;
  }
  if (value === "") {
    io.err("没有读到 key，原来的没有改动。");
    return 1;
  }
  const problem = apiKeyProblem(value);
  if (problem !== null) {
    io.err(`这把 key ${problem}。原来的没有改动。`);
    return 1;
  }
  await ensureRunning(io);
  if (!(await submitKey(io, value, provider))) return 1;
  if (provider.id !== currentProvider(io).id) io.out(`要换成用它：speakmore model ${provider.id}`);
  return 0;
}
