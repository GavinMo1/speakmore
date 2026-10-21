import { named, platformName } from "../../shared/dom.mjs";
import { t } from "../../shared/i18n.mjs";

// 引擎页的状态怎么定：哪个环节在用、哪一项是选定的、看哪个渠道、还差什么、线画成哪种。
// 只读主进程拼好的数据（app/model-plaza.mjs 的 describePlaza），不碰页面，单元测试在 Node 里跑。

/** 三个环节 → 设置里那一项、属于哪种识别方式、图标。转写在两种方式里都有：数据隐私方式用它自己那一项（privateTranscriber） */
export const ROLES = Object.freeze({
  native: { setting: "native", mode: "native", icon: "i-sparkles" },
  transcribe: { setting: "transcriber", mode: "local", icon: "i-audio-lines" },
  polish: { setting: "polish", mode: "local", icon: "i-wand-sparkles" },
});
export const ROLE_IDS = Object.freeze(Object.keys(ROLES));

/** 三种方式平级，先后只照连线排：数据隐私夹在中间，连到转写的两条线并到一处、不交叉 */
export const MODE_ORDER = Object.freeze(["native", "private", "local"]);
/** 每种方式一路经过哪几个环节 */
export const MODE_ROLES = Object.freeze({
  native: ["native"],
  private: ["transcribe"],
  local: ["transcribe", "polish"],
});
export const MODE_ICONS = Object.freeze({ native: "i-sparkles", local: "i-wand-sparkles", private: "i-shield-check" });

/** 平台是某家自己的开放平台时，渠道上写"官方"（百炼另有名字，不算） */
const OFFICIAL = Object.freeze({
  deepseek: "deepseek",
  moonshot: "kimi",
  zhipu: "zhipu",
  minimax: "minimax",
  gemini: "gemini",
  openai: "openai",
});

export const modeName = (mode) => t(`plaza.modes.${mode}`);
export const roleName = (role) => t(`plaza.roles.${role}`);
export const backendLabel = (item) => t("plaza.build", { backend: t(`localModels.backends.${item.backend ?? "cpu"}`) });

/** 树上、搜索里认一项用的键：本机模型是 id，云端是名字，自定义服务只有一项 */
export const itemKey = (item) => item.choice ?? item.name ?? "custom";

export function makerName(group) {
  if (group.kind === "local") return t("plaza.groups.local");
  if (group.kind === "custom") return t("plaza.groups.custom");
  return named(`plaza.makers.${group.id}`, group.id);
}

/** 一项叫什么：本机模型同名的几个靠做法分（Metal 版、CPU 版），要的时候带上 */
export function itemName(group, item, { withBuild = false } = {}) {
  if (group.kind === "custom") return t("plaza.custom.name");
  if (withBuild && group.kind === "local" && item.backend) return `${item.name} · ${backendLabel(item)}`;
  return item.name;
}

/**
 * @param {object} plaza 主进程给的（getSetup 的 plaza）
 * @param {{ via?: Record<string, string>, custom?: { form: object | null, draft: object | null } }} [ui]
 *   页面上的选择：各组看哪个渠道（组 id → 平台 id）；自定义服务验证过、还没换上的草稿
 */
export function plazaView(plaza, { via = {}, custom = { form: null, draft: null } } = {}) {
  const platformOf = (id) => plaza.platforms.find((platform) => platform.id === id) ?? null;
  const hasKey = (id) => Boolean(platformOf(id)?.key);
  const privateNow = () => plaza.mode === "private";
  /** 这个环节现在选的写在哪一项：数据隐私方式里转写是它自己的那一项 */
  const settingOf = (role) => (role === "transcribe" && privateNow() ? "privateTranscriber" : ROLES[role].setting);
  const chosenOf = (role) => plaza.chosen[settingOf(role)];
  /** 这个环节在正在用的识别方式里：转写在转写 + 润色、数据隐私两种里都算 */
  const isLive = (role) => MODE_ROLES[plaza.mode].includes(role);

  /** 启用这一项要用哪种识别方式：数据隐私方式里启用本机模型还在它里面，别的照环节 */
  const modeFor = (role, group) =>
    role === "transcribe" && privateNow() && group.kind === "local" ? "private" : ROLES[role].mode;
  /** 启用这一项写进设置的哪一项 */
  const settingFor = (role, group) => (modeFor(role, group) === "private" ? "privateTranscriber" : ROLES[role].setting);

  // ---------- 渠道 ----------

  /** 这一组正在用的那个模型的渠道 */
  function chosenVia(role, group) {
    const chosen = chosenOf(role);
    for (const item of group.items) {
      for (const [id, offer] of Object.entries(item.offers ?? {})) if (offer.choice === chosen) return id;
    }
    return null;
  }

  /** 这一组看哪个渠道：选过的，否则正在用的，否则配了密钥的，否则第一个 */
  function viaOf(role, group) {
    if (group.kind !== "cloud") return group.channels[0];
    return via[group.id] ?? chosenVia(role, group) ?? group.channels.find(hasKey) ?? group.channels[0];
  }

  /** 这一项在看的渠道上的那一份（{ choice, price, unverified }）；这个渠道不卖它时是 null */
  const offerOf = (role, group, item) => (group.kind === "cloud" ? (item.offers[viaOf(role, group)] ?? null) : null);

  /** 渠道叫什么：自家开放平台写"官方"（只有这一个渠道时写"某某 官方"），别的写平台名 */
  function channelName(group, id) {
    const platform = platformName(platformOf(id) ?? { id, name: id });
    if (OFFICIAL[id] !== group.id) return platform;
    return group.channels.length === 1 ? t("plaza.channel.officialOf", { platform }) : t("plaza.channel.official");
  }

  // ---------- 自定义服务 ----------

  /** 设置里存的自定义服务：模型名（润色没选它时是空的）、地址、额外参数 */
  function storedCustom() {
    const { polish, customUrl: url, customParams: params } = plaza.chosen;
    return { model: polish.startsWith("custom/") ? polish.slice("custom/".length) : "", url, params };
  }
  /** 启用、检测时交的：验证过还没换上的草稿，没有就是设置里存的 */
  const customNow = () => custom.draft ?? storedCustom();
  function customChoice() {
    const { model } = customNow();
    return model ? `custom/${model}` : null;
  }
  /** 自定义服务除了模型名还要一起交的两项 */
  const customExtra = () => ({ customUrl: customNow().url, customParams: customNow().params });
  const customReady = () => hasKey("custom") && customChoice() !== null && customNow().url !== "";

  // ---------- 选定、在用 ----------

  /** 这一项写进设置的样子：本机模型是 id，云端是 厂商/模型（看的那个渠道上的） */
  function choiceOf(role, group, item) {
    if (group.kind === "local") return item.choice;
    if (group.kind === "custom") return customChoice();
    return offerOf(role, group, item)?.choice ?? null;
  }

  /** 这一项是不是这个环节选定的那个（哪个渠道上的都算）：树上的标记、连线按它 */
  function holds(role, group, item) {
    const chosen = chosenOf(role);
    if (group.kind === "local") return item.choice === chosen;
    if (group.kind === "custom") return role === "polish" && chosen.startsWith("custom/");
    return Object.values(item.offers).some((offer) => offer.choice === chosen);
  }
  const groupHolds = (role, group) => group.items.some((item) => holds(role, group, item));

  /**
   * 详情里这一项算不算已经选定：要看的渠道上的那一份就是选定的。换个渠道看，同一个模型要再启用一次；
   * 自定义服务有验证过、还没换上的草稿时也不算，留着启用让它生效
   */
  function isChosen(role, group, item) {
    const choice = choiceOf(role, group, item);
    if (choice === null || chosenOf(role) !== choice) return false;
    return group.kind !== "custom" || custom.draft === null;
  }

  /** 这个环节选定的那一项：{ group, item }；一个都没有是 null */
  function chosenSpot(role) {
    for (const group of plaza.shelves[role]) {
      for (const item of group.items) if (holds(role, group, item)) return { group, item };
    }
    return null;
  }

  // ---------- 差什么 ----------

  /** 这一项现在差什么：download、downloading、key、custom、channel；什么都不差是 null */
  function blocker(role, group, item) {
    if (group.kind === "local") {
      if (item.download) return "downloading";
      return item.installed ? null : "download";
    }
    if (group.kind === "custom") return customReady() ? null : "custom";
    if (!hasKey(viaOf(role, group))) return "key";
    return offerOf(role, group, item) ? null : "channel";
  }

  /** 这一组整体差什么（厂商节点上那一行）：哪个渠道都没有密钥 */
  function groupBlocker(group) {
    if (group.kind === "local") return null;
    if (group.kind === "custom") return customReady() ? null : "custom";
    return group.channels.some(hasKey) ? null : "key";
  }

  // ---------- 线 ----------

  /** 连到这一项的线：live 正在用的那一路，standby 已选定、方式没在用（虚线），base 其余 */
  const lineKind = (role, holding) => (holding ? (isLive(role) ? "live" : "standby") : "base");
  const lineOf = (role, group, item) => lineKind(role, holds(role, group, item));
  const groupLine = (role, group) => lineKind(role, groupHolds(role, group));

  return {
    plaza,
    platformOf,
    hasKey,
    settingOf,
    chosenOf,
    isLive,
    modeFor,
    settingFor,
    viaOf,
    offerOf,
    channelName,
    storedCustom,
    customNow,
    customChoice,
    customExtra,
    choiceOf,
    holds,
    groupHolds,
    isChosen,
    chosenSpot,
    blocker,
    groupBlocker,
    lineOf,
    groupLine,
  };
}

/**
 * 搜索：名字、做的那家、各渠道上的写法、本机模型的 id，包含就算，大小写不论
 * @returns {Array<{ role: string, group: object, item: object }>}
 */
export function searchPlaza(plaza, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const role of ROLE_IDS) {
    for (const group of plaza.shelves[role]) {
      for (const item of group.items) {
        const text = [
          itemName(group, item, { withBuild: true }),
          makerName(group),
          group.id,
          item.choice ?? "",
          ...Object.values(item.offers ?? {}).map(({ choice }) => choice),
        ]
          .join(" ")
          .toLowerCase();
        if (text.includes(q)) hits.push({ role, group, item });
      }
    }
  }
  return hits;
}
