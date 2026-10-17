// 首次引导里"打算怎么用"：选哪种识别方式、那种方式里用哪家、用哪个本机模型，还差什么、换过去要带哪几项设置。
// 纯函数，不碰页面；数据都是 getSetup 给的那一份。
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

/** 打开引导时的打算：照现在的设置。润色选的是自定义服务时换成能挑的第一家 */
export function initialPlan(setup) {
  const polish = vendorOf(setup.local.polish);
  const polishVendors = vendorsFor(setup, "local");
  return {
    mode: setup.mode.value,
    native: vendorOf(setup.native.model),
    polish: polishVendors.some(({ id }) => id === polish) ? polish : polishVendors[0].id,
  };
}

/**
 * 转写 + 润色、数据隐私用哪个本机模型：设置里那个已经下好了就用它；
 * 否则用这台机器的推荐组合（models/presets.mjs，已按芯片挑过）里那种方式的模型；都没有时照设置
 */
export function localModelOf(setup, mode) {
  const models = setup.local.transcribers;
  const current = mode === "private" ? setup.private.transcriber : setup.local.transcriber;
  const find = (id) => models.find((model) => model.id === id);
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

/** 这套打算换过去之前还差什么：[{ kind: "download", model, downloading }, { kind: "key", vendor }]；不差是空的 */
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

/** 这套打算现在能用：不差什么，也已经换上了 */
export const planReady = (plan, setup) => needsOf(plan, setup).length === 0 && inEffect(plan, setup);

/**
 * 只差本机模型还在下：引导关了也要等它下完再换过去（交给主进程，app/pending-switch.mjs）。
 * 别的还差（没 key、没开始下）的不等：那是用户跳过了，进去再配
 */
export function waitingDownload(plan, setup) {
  const needs = needsOf(plan, setup);
  if (needs.length !== 1 || needs[0].kind !== "download" || !needs[0].downloading) return null;
  return { mode: plan.mode, changes: changesOf(plan, setup), model: needs[0].model };
}
