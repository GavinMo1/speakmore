// 引擎页"划词"那一段的状态怎么定：哪一项在用、看哪个渠道、还差什么。和语音那一段（plaza-view.mjs）各管各的：
// 划词只有一项设置（lookup.model），没有识别方式、环节之分；自定义服务是划词自己的（地址、参数、key 都另存）。
// 只读主进程给的（getSetup 的 plaza.shelves.lookup、plaza.platforms、lookup），不碰页面，单元测试在 Node 里跑。

/**
 * @param {{ plaza: object, lookup: { model: string, customUrl: string, customParams: string, customKey: string | null } }} setup
 * @param {{ via?: Record<string, string> }} [ui] 各组看哪个渠道（组 id → 平台 id）：详情里换过的
 */
export function lookupView({ plaza, lookup }, { via = {} } = {}) {
  const shelf = plaza.shelves.lookup;
  const platformOf = (id) => plaza.platforms.find((platform) => platform.id === id) ?? null;
  const hasKey = (id) => Boolean(platformOf(id)?.key);
  const chosen = lookup.model;
  const customInUse = chosen.startsWith("custom/");

  /** 这一组正在用的那个模型在哪个渠道上 */
  function chosenVia(group) {
    for (const item of group.items) {
      for (const [id, offer] of Object.entries(item.offers ?? {})) if (offer.choice === chosen) return id;
    }
    return null;
  }

  /** 这一组看哪个渠道：选过的，否则正在用的，否则配了密钥的，否则第一个 */
  function viaOf(group) {
    if (group.kind !== "cloud") return group.channels[0];
    return via[group.id] ?? chosenVia(group) ?? group.channels.find(hasKey) ?? group.channels[0];
  }

  /** 这一项在看的渠道上的那一份（{ choice, price, unverified }）；这个渠道不卖它时是 null */
  const offerOf = (group, item) => (group.kind === "cloud" ? (item.offers[viaOf(group)] ?? null) : null);

  /** 自定义服务现在的样子：模型名（在用时才有）、地址、参数 */
  const customNow = () => ({
    model: customInUse ? chosen.slice("custom/".length) : "",
    url: lookup.customUrl,
    params: lookup.customParams,
  });
  /** 自定义服务能用：有 key、有地址（模型名在启用时填） */
  const customReady = () => lookup.customKey !== null && lookup.customUrl !== "";

  /** 这一项写进设置的样子：厂商/模型（看的那个渠道上的）；自定义服务在详情的表单里交，不走这里 */
  const choiceOf = (group, item) => offerOf(group, item)?.choice ?? null;

  /** 这一项是不是在用的那个（哪个渠道上的都算）：树上的标记、连线按它 */
  function holds(group, item) {
    if (group.kind === "custom") return customInUse;
    return Object.values(item.offers).some((offer) => offer.choice === chosen);
  }
  const groupHolds = (group) => group.items.some((item) => holds(group, item));

  /** 详情里算不算已经选定：要看的渠道上的那一份就是在用的。换个渠道看，同一个模型要再启用一次 */
  function isChosen(group, item) {
    if (group.kind === "custom") return customInUse;
    const choice = choiceOf(group, item);
    return choice !== null && choice === chosen;
  }

  /** 在用的那一项：{ group, item }；设置里写的不在货架上（命令行写了清单外的型号）是 null */
  function chosenSpot() {
    for (const group of shelf) {
      for (const item of group.items) if (holds(group, item)) return { group, item };
    }
    return null;
  }

  /** 这一项现在差什么：key（看的渠道没密钥）、channel（这个渠道不卖它）、custom（自定义服务没配齐）；不差是 null */
  function blocker(group, item) {
    if (group.kind === "custom") return customReady() ? null : "custom";
    if (!hasKey(viaOf(group))) return "key";
    return offerOf(group, item) ? null : "channel";
  }

  /** 这一组整体差什么（厂商节点上那一行）：哪个渠道都没有密钥、自定义服务没配齐 */
  function groupBlocker(group) {
    if (group.kind === "custom") return customReady() ? null : "custom";
    return group.channels.some(hasKey) ? null : "key";
  }

  return {
    shelf,
    platformOf,
    hasKey,
    viaOf,
    offerOf,
    customNow,
    choiceOf,
    holds,
    groupHolds,
    isChosen,
    chosenSpot,
    blocker,
    groupBlocker,
  };
}
