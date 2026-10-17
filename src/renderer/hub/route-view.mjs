import { brand, h, platformName } from "../shared/dom.mjs";
import { t } from "../shared/i18n.mjs";

// 一条路线怎么画（首页的识别方式选单、模型页的推荐组合共用）：一路经过的模型、切过去之前还差什么。
// 数据是主进程拼的（app/model-plaza.mjs 的 wayOf）：hops 按先后，needs 是缺的 key、没下载的本机模型、没写的地址。

/**
 * 一路经过的模型：图标加名字，后一个带着前面的箭头一起折行（箭头不会落单在行尾）；悬停说在哪个平台上
 * @param {Array<{ platform: string, maker: string | null, name: string }>} hops
 * @param {(id: string) => { id: string, name: string }} platformOf 平台 id → 平台（密钥表里那一行）
 */
export function hopChain(hops, platformOf) {
  if (hops.length === 0) return null;
  return h(
    "span",
    { class: "hops" },
    hops.map(({ platform, maker, name }, index) => {
      const where = platform === "local" ? t("plaza.via.local") : platformName(platformOf(platform));
      const text = platform === "custom" ? `${t("plaza.custom.name")} · ${name}` : name;
      return h(
        "span",
        { class: "hop", title: `${text} · ${where}` },
        index > 0 && h("span", { class: "hop-arrow", "aria-hidden": "true", text: "→" }),
        brand(maker ?? platform),
        h("span", { class: "hop-name", text }),
      );
    }),
  );
}

/**
 * 还差的一样，写成一个短语："阿里云百炼 密钥未配置"、"Qwen3-ASR 0.6B (Q8_0) 未下载"
 * @param {{ kind: "key" | "download" | "url", platform?: string, model?: string }} need
 * @param {{ hops: Array<object>, platformOf: (id: string) => object }} way 那条路线（下载时取本机模型的名字）
 */
export function needText(need, { hops, platformOf }) {
  if (need.kind === "key") return t("home.mode.needs.key", { platform: platformName(platformOf(need.platform)) });
  if (need.kind === "download") {
    const hop = hops.find(({ platform }) => platform === "local");
    return t("home.mode.needs.download", { model: hop?.name ?? need.model });
  }
  return t("home.mode.needs.url");
}
