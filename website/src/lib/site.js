// 页面上的各种地址都从 site.config.json 和版本号算出来，组件里不写死域名。

/**
 * @param {{ siteUrl: string, downloadBase: string, mediaBase: string, repository: string }} site
 * @param {string} version 当前发布的版本号，不带 v（取仓库根上 package.json 的）
 */
export function siteLinks(site, version) {
  const base = site.downloadBase.replace(/\/+$/, "");
  const media = site.mediaBase.replace(/\/+$/, "");
  return {
    version,
    dmg: {
      arm64: `${base}/v${version}/SpeakMore-arm64.dmg`,
      x64: `${base}/v${version}/SpeakMore-x64.dmg`,
    },
    install: `curl -fsSL ${base}/install.sh | bash`,
    repository: site.repository,
    license: `${site.repository}/blob/main/LICENSE`,
    /** COS 上一张图的地址；path 是 src/media.json 里记的对象名 */
    media: (path) => `${media}/${path}`,
  };
}
