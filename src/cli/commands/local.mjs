import { msg } from "../../i18n/index.mjs";
import { downloadSize, MODELS } from "../../server/asr/catalog.mjs";
import { createModelStore } from "../../server/asr/store.mjs";
import { CHAT_VENDORS, findChatVendor, parseChatChoice } from "../../server/chat/vendors.mjs";
import { currentSettings, ensureRunning, parse, renderOptions, UsageError } from "../common.mjs";
import { polishTitle, renderPolish, renderTranscribers } from "../render/modes.mjs";
import { keySourceFor } from "./key.mjs";
import { needUrl } from "./mode.mjs";
import { applyChange, checked, ensureKey, inMode, modeNow, routeWith } from "./route.mjs";

// local 模式的两跳，各一个命令，只在 local 模式里能换（不在就说先 speakmore mode local）：
//   speakmore transcriber   第一跳：本机转写模型。不用 key，没下载过的在后台下载
//   speakmore polish        第二跳：润色的厂商和模型；自定义服务（兼容 OpenAI 接口）连同地址
// 列出来看在哪种模式里都行，不在 local 时开头说一句现在用不上。

/** 检查要等后台应用问一次那一家，那边的超时是 30 秒 */
const CHECK_TIMEOUT_MS = 45_000;

export async function transcriber(args, io) {
  const [wanted, ...extra] = parse(args).positionals;
  if (extra.length > 0) throw new UsageError(msg("cli.syntax.transcriber"));
  const status = await io.daemon.status();
  if (wanted === undefined) {
    const store = createModelStore({ dir: io.paths.modelsDir });
    const models = MODELS.map((model) => ({
      id: model.id,
      name: model.name,
      license: model.license,
      bytes: downloadSize(model),
      installed: store.isInstalled(model),
    }));
    const view = { models, setting: currentSettings(io).transcriber.value, current: modeNow(io, status) };
    io.out(renderTranscribers(view, renderOptions(io)));
    return 0;
  }
  const { transcriber: id } = checked(io, { transcriber: wanted });
  if (!inMode(io, status, "local", "transcriber")) return 1;
  return applyChange(io, {
    command: "set-transcriber",
    params: { transcriber: id },
    changes: { transcriber: id },
    done: msg("cli.local.transcriberSwitched", { model: id }),
  });
}

export async function polish(args, io) {
  const { values, positionals } = parse(args, { url: { type: "string" } });
  const [first, second, ...extra] = positionals;
  if (extra.length > 0) throw new UsageError(msg("cli.syntax.polish"));
  if (first === "check") return check(io, second, values.url);
  if (second !== undefined) throw new UsageError(msg("cli.syntax.polish"));
  const status = await io.daemon.status();
  if (first === undefined) {
    if (values.url !== undefined) throw new UsageError(msg("cli.syntax.polish"));
    return list(io, status);
  }

  // 先查写得对不对（以 2 退出），再看是不是在 local 模式里（以 1 退出）
  const changes = choiceFrom(io, first, values.url);
  const route = routeWith(io, "local", changes);
  needUrl(route);
  if (!inMode(io, status, "local", "polish")) return 1;
  const vendor = findChatVendor(route.polish.vendor);
  if (!(await ensureKey(io, vendor, changes))) return 1;
  return applyChange(io, {
    command: "set-polish",
    params: changes,
    changes,
    done: msg("cli.local.polishSwitched", { model: polishTitle(route.polish, route.customUrl) }),
  });
}

/**
 * 用户写的润色模型（和地址）→ 查过的设置。写的是收音频的那家、写错了，以 2 退出说能填什么
 * @returns {{ polish: string, customUrl?: string }}
 */
function choiceFrom(io, value, url) {
  const changes = url === undefined ? { polish: value } : { polish: value, customUrl: url };
  return checked(io, changes);
}

function list(io, status) {
  const settings = currentSettings(io);
  const keys = Object.fromEntries(CHAT_VENDORS.map((vendor) => [vendor.id, keySourceFor(io, vendor, status)]));
  const view = {
    vendors: CHAT_VENDORS,
    polish: parseChatChoice(settings.polish.value),
    customUrl: settings.customUrl.value,
    keys,
    current: modeNow(io, status),
  };
  io.out(renderPolish(view, renderOptions(io)));
  return 0;
}

/** 第二跳的某个模型现在能不能用：交给后台应用，用那一家的 key 发一个最小的请求。在哪种模式里都能查 */
async function check(io, value, url) {
  const changes = value === undefined ? {} : choiceFrom(io, value, url);
  const route = routeWith(io, "local", changes);
  needUrl(route);
  await ensureRunning(io);
  const title = io.t.text(polishTitle(route.polish, route.customUrl));
  io.out(io.t("cli.model.checking", { model: title }));
  const params = { polish: `${route.polish.vendor}/${route.polish.model}` };
  if (changes.customUrl !== undefined) params.customUrl = changes.customUrl;
  let result;
  try {
    result = await io.daemon.request("check-polish", params, { timeoutMs: CHECK_TIMEOUT_MS });
  } catch (error) {
    // 正在运行的是升级之前启动的那一个，还不认识这条命令
    if (!/^不认识的命令/.test(error?.message ?? "")) throw error;
    io.err(io.t("cli.model.oldDaemonCheck"));
    return 1;
  }
  if (!result.ok) {
    io.err(io.t("cli.model.unusable", { problem: result.problem }));
    return 1;
  }
  const vendor = findChatVendor(route.polish.vendor);
  const from =
    result.source === "env" ? msg("cli.model.fromEnv", { variable: vendor.keyEnv }) : msg("cli.model.fromStored");
  io.out(io.t("cli.model.usable", { model: title, from, seconds: (result.ms / 1000).toFixed(1) }));
  return 0;
}
