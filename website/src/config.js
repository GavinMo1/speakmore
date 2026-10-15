// 站点配置：域名、下载地址、图片地址都在 site.config.json；版本号是构建时从仓库根的 package.json 读的（vite.config.js）。
import site from "../site.config.json";
import { siteLinks } from "./lib/site.js";
import media from "./media.json";

/* global __SPEAKMORE_VERSION__ */
export const links = siteLinks(site, __SPEAKMORE_VERSION__);

/**
 * 一张截图：名字是 scripts/screenshots.mjs 起的（home-light-ink），按语言取对应的那一份
 * @returns {{ src: string, width: number, height: number }}
 */
export function shot(name, locale) {
  const entry = media[`${name}.${locale}`];
  if (!entry) throw new Error(`src/media.json 里没有 ${name}.${locale}：先截图再上传`);
  return { src: links.media(entry.path), width: entry.width, height: entry.height };
}
