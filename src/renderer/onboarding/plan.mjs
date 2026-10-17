// 首次引导里"怎么用"：哪种识别方式、那种方式里用哪家、用哪个本机模型，还差什么、换过去要带哪几项设置。
// 纯函数，不碰页面；数据都是 getSetup 给的那一份。
// 引导里点了哪种、哪家就当场换上（app/modes.mjs 的 switchMode 不验 key、不等下载），所以打算就是现在的设置；
// 还差的（缺 key、模型没下载）照实写出来，补齐了自己就能用。
// 引导只摆最常见的搭法：原生选一家收音频的，转写 + 润色是本机模型加一家润色，数据隐私只要本机模型。
// 云端转写、自定义服务这些更自由的搭法在主窗口的模型页。

export const WAYS = ["native", "local", "private"];

const vendorOf = (choice) => choice.split("/")[0];

/** 某种方式里能挑的那几家：原生是收音频的，转写 + 润色是润色的（自定义服务要填地址和模型名，留给模型页） */
export function vendorsFor(setup, mode) {
  if (mode === "native") return setup.native.providers;
  if (mode === "local") return setup.local.vendors.filter(({ id }) => id !== "custom");
  return [];
}

/** 现在的打算：照现在的设置。润色选的是自定义服务时换成能挑的第一家（引导里不列自定义服务） */
export function planOf(setup) {
  const polish = vendorOf(setup.local.polish);
  const polishVendors = vendorsFor(setup, "local");
  return {
    mode: setup.mode.value,
    native: vendorOf(setup.native.model),
    polish: polishVendors.some(({ id }) => id === polish) ? polish : polishVendors[0].id,
  };
}

/**
 * 转写 + 润色、数据隐私用哪个本机模型。正在用的那种方式：就是设置里那个，下没下好都照实说。
 * 换过去时：设置里那个已经下好了就用它；否则用这台机器的推荐组合（models/presets.mjs，已按芯片挑过）里
 * 那种方式的模型；都没有时照设置
 */
export function localModelOf(setup, mode) {
  const models = setup.local.transcribers;
  const current = mode === "private" ? setup.private.transcriber : setup.local.transcriber;
  const find = (id) => models.find((model) => model.id === id);
  if (mode === setup.mode.value && find(current)) return current;
  if (find(current)?.installed) return current;
  const recommended = setup.plaza.presets
    .filter((preset) => preset.mode === mode)
    .map(({ settings }) => settings.transcriber ?? settings.privateTranscriber)
    .find((id) => find(id));
  if (recommended) return recommended;
  // 设置里的是云端转写（转写 + 润色的第一跳可以是）时没有本机模型可照：用清单里的第一个
  return find(current) ? current : models[0].id;
}

/** 某一家有没有能用的 key。服务正拿着它的 key 时看那把的状态：被拒了、读不出的都算没有 */
export function hasKey(setup, mode, id) {
  if (id === setup.provider?.id) return setup.key.state === "ready" || setup.key.state === "checking";
  return vendorsFor(setup, mode).find((vendor) => vendor.id === id)?.key != null;
}

/** 这一套还差什么才能用：[{ kind: "download", model, downloading }, { kind: "key", vendor }]；不差是空的 */
export function needsOf(plan, setup) {
  const needs = [];
  if (plan.mode !== "native") {
    const model = localModelOf(setup, plan.mode);
    const item = setup.local.transcribers.find(({ id }) => id === model);
    if (!item?.installed) needs.push({ kind: "download", model, downloading: Boolean(item?.download) });
  }
  const vendor = plan.mode === "native" ? plan.native : plan.mode === "local" ? plan.polish : null;
  if (vendor && !hasKey(setup, plan.mode, vendor)) needs.push({ kind: "key", vendor });
  return needs;
}

/**
 * 换过去时带上那种方式的哪几项设置（app/modes.mjs 的 switchMode 收的）。
 * 选的就是设置里那家时不带：设置里可能已经挑好了它的哪个模型，不用换回默认的
 */
export function changesOf(plan, setup) {
  if (plan.mode === "native") return plan.native === vendorOf(setup.native.model) ? {} : { model: plan.native };
  if (plan.mode === "local") {
    return {
      transcriber: localModelOf(setup, "local"),
      ...(plan.polish === vendorOf(setup.local.polish) ? {} : { polish: plan.polish }),
    };
  }
  return { privateTranscriber: localModelOf(setup, "private") };
}

/** 现在用的已经就是这一套 */
export function inEffect(plan, setup) {
  if (setup.mode.value !== plan.mode) return false;
  const current = {
    model: setup.native.model,
    transcriber: setup.local.transcriber,
    polish: setup.local.polish,
    privateTranscriber: setup.private.transcriber,
  };
  return Object.entries(changesOf(plan, setup)).every(([name, value]) => current[name] === value);
}

/**
 * 按热键现在能不能说（体验一下、完成两步用）：null 是能；否则 { tone, needs, problem? }。
 * 还差的（needsOf）先说：只差模型在下是 progress，别的是 problem；不差了但 key 还在验、本机模型还在装是 progress；
 * key 没通过、模型没装上带着原因
 */
export function readinessOf(setup) {
  const needs = needsOf(planOf(setup), setup);
  if (needs.length > 0) {
    const downloading = needs.every((need) => need.kind === "download" && need.downloading);
    return { tone: downloading ? "progress" : "problem", needs };
  }
  if (setup.key.state === "checking" || setup.localModel?.state === "loading") return { tone: "progress", needs };
  if (setup.key.state === "rejected" || setup.key.state === "unreadable") {
    return { tone: "problem", needs, problem: setup.key.problem };
  }
  if (setup.localModel?.state === "failed") return { tone: "problem", needs, problem: setup.localModel.problem };
  return null;
}
