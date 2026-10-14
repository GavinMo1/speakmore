import { findProvider, formatModelChoice, PROVIDERS, parseModelChoice } from "../../server/providers/index.mjs";
import { Cancelled } from "../ask-secret.mjs";
import { ConfigError, currentSettings, ensureRunning, parse, renderOptions, UsageError } from "../common.mjs";
import { renderModels } from "../render/models.mjs";
import { applySettings, storeSetting, warnIfEnvOverrides } from "./config.mjs";
import { currentProvider, keyPrompter, keySource, keySourceFor, submitKey } from "./key.mjs";

// speakmore model：看有哪几家、换用哪一家的哪个模型、检查某个模型现在能不能用。
// 换模型其实就是改设置里的 model，和 speakmore config set model 是一回事；这里多做两件事：
// 先确认那一家有 key（没有就问），以及用人话说清换成了什么。

const USAGE = "speakmore model | speakmore model <厂商>[/<模型>] | speakmore model check [<厂商>[/<模型>]]";
/** 检查要等后台应用问一次那一家，那边的超时是 30 秒 */
const CHECK_TIMEOUT_MS = 45_000;

/** 用户写的模型 → { provider, model }；写错了以 2 退出，说能填什么 */
function choiceFrom(value) {
  // 只写一个词时必须是厂商名。设置文件里"只写 Gemini 的模型名"那种旧写法这里不认：
  // 否则 speakmore model deepseek 会被当成一个叫 deepseek 的 Gemini 模型
  if (!value.includes("/") && findProvider(value) === null) {
    throw new ConfigError(
      `不认识 ${value} 这家，能用的有 ${PROVIDERS.map(({ id }) => id).join(" / ")}。指定模型写成 厂商/模型`,
    );
  }
  try {
    return parseModelChoice(value);
  } catch (error) {
    throw new ConfigError(`模型写的是 ${JSON.stringify(value)}，${error.message}`);
  }
}

const describe = ({ provider, model }) => `${findProvider(provider).name} 的 ${model}`;

const MAX_CHOICE_ATTEMPTS = 3;

/**
 * 第一次启动、还没有 key 时先问用哪一家：手里有哪家的 key，因人而异。
 * 选的不是现在设置里那家就记进设置；别家已经有 key 的标出来，选它就不用再填。
 * @returns {Promise<object | null>} 选定的那一家；按了 Ctrl-C、或者问够了次数还没选上时是 null（不纠缠）
 */
export async function chooseProvider(io) {
  const current = currentProvider(io);
  const options = PROVIDERS.map((provider, index) => {
    const notes = [`默认用 ${provider.defaultModel}`, ...(keySource(io, provider) ? ["已经有 key"] : [])];
    return `  ${index + 1}  ${provider.name.padEnd(8)}${notes.join("，")}`;
  });
  const fallback = PROVIDERS.indexOf(current) + 1;
  const question = [
    "",
    "先选用哪一家的模型把录音整理成文字（以后可以用 speakmore model 换）：",
    ...options,
    `输入编号后按回车（直接回车选 ${fallback}）：`,
  ].join("\n");
  for (let attempt = 0; attempt < MAX_CHOICE_ATTEMPTS; attempt++) {
    let answer;
    try {
      answer = (await io.ask(attempt === 0 ? question : "输入编号后按回车：")).trim();
    } catch (error) {
      if (error instanceof Cancelled) return null;
      throw error;
    }
    const chosen = answer === "" ? current : (PROVIDERS[Number(answer) - 1] ?? findProvider(answer));
    if (chosen) {
      if (chosen.id !== current.id) storeSetting(io, "model", chosen.id);
      return chosen;
    }
    io.err(`没有 ${answer} 这一项，能选 ${PROVIDERS.map(({ name }, index) => `${index + 1}（${name}）`).join("、")}。`);
  }
  return null;
}

async function list(io) {
  // 正在用的那家的 key 可能是启动后台应用时从环境变量给的，命令行这边看不到：问一下在运行的那个
  const running = await io.daemon.status();
  const fromDaemon = (provider) =>
    running?.provider === provider.id && running.key.state === "ready" && running.key.source === "env" ? "env" : null;
  const keys = Object.fromEntries(
    PROVIDERS.map((provider) => [provider.id, keySourceFor(io, provider, running) ?? fromDaemon(provider)]),
  );
  io.out(renderModels({ providers: PROVIDERS, setting: currentSettings(io).model, keys }, renderOptions(io)));
  return 0;
}

/**
 * 换成某一家的某个模型。那一家还没有 key 的话先问一把、验证过存好再换：
 * 不然重启之后才发现用不了，用户还得回头去填。
 */
async function switchTo(io, value) {
  const choice = choiceFrom(value);
  const provider = findProvider(choice.provider);
  const before = currentSettings(io).model.value;

  if (keySourceFor(io, provider, await io.daemon.status()) === null) {
    if (!io.interactive) {
      io.err(`还没有 ${provider.name} 的 key，没有换：先运行 speakmore key ${provider.id}，再换。`);
      return 1;
    }
    // 先问再启动：启动的那段时间终端照常回显，提前粘贴的 key 会显示出来（同 speakmore start）
    const nextKey = keyPrompter(io, provider);
    let saved = false;
    for (let key = await nextKey(); key !== null; key = await nextKey()) {
      await ensureRunning(io);
      if (await submitKey(io, key, provider)) {
        saved = true;
        break;
      }
    }
    if (!saved) {
      io.err(`没有换：还没有 ${provider.name} 的 key。`);
      return 1;
    }
  }

  const stored = storeSetting(io, "model", formatModelChoice(choice));
  io.out(`模型换成了 ${describe(parseModelChoice(stored))}。`);
  warnIfEnvOverrides(io, "model");
  return applySettings(io, `speakmore model ${before}`);
}

/** 某个模型现在能不能用：交给后台应用，用那一家的 key 发一个最小的请求 */
async function check(io, value) {
  const choice = value === undefined ? parseModelChoice(currentSettings(io).model.value) : choiceFrom(value);
  await ensureRunning(io);
  io.out(`正在检查 ${describe(choice)}…`);
  let result;
  try {
    result = await io.daemon.request(
      "check-model",
      { model: formatModelChoice(choice) },
      { timeoutMs: CHECK_TIMEOUT_MS },
    );
  } catch (error) {
    // 正在运行的是升级之前启动的那一个，还不认识这条命令
    if (!/^不认识的命令/.test(error?.message ?? "")) throw error;
    io.err("正在运行的 SpeakMore 是旧版本，查不了：运行 speakmore restart 之后再查。");
    return 1;
  }
  if (!result.ok) {
    io.err(`不能用：${result.problem}`);
    return 1;
  }
  const provider = findProvider(choice.provider);
  const from = result.source === "env" ? `环境变量 ${provider.keyEnv} 里的 key` : "存着的 key";
  io.out(`能用：${describe(choice)}，用的是${from}，来回 ${(result.ms / 1000).toFixed(1)} 秒。`);
  return 0;
}

export async function model(args, io) {
  const [first, second, ...extra] = parse(args).positionals;
  if (first === undefined) return list(io);
  if (first === "check" && extra.length === 0) return check(io, second);
  if (second === undefined) return switchTo(io, first);
  throw new UsageError(`用法：${USAGE}`);
}
