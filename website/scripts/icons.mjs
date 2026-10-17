// 从 Iconify 取页面用到的图标，写成 src/icons/data.js。加图标：在下面登记一行，再跑 npm run icons。
// 取下来的 SVG 直接打进页面，不在访客打开时再去 Iconify 要：少一个外部依赖，也不往第三方报访客的来路。
//
// 界面图标只用 Remix Icon（ri，Apache-2.0）一套；Apple、Windows、GitHub 的标志
// 也用它。Remix 没有的硬件厂商标志（NVIDIA、AMD、Intel）用 Simple Icons（CC0；标志本身归各家所有）。
// 各家模型的标志不在这里：直接用 App 里那一份（src/renderer/shared/provider-icons.mjs）。
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 页面里的名字 → Iconify 里的 "图标集:名字" */
const ICONS = {
  // 界面
  terminal: "ri:terminal-box-line",
  copy: "ri:file-copy-line",
  check: "ri:check-line",
  globe: "ri:global-line",
  arrowLeft: "ri:arrow-left-line",
  arrowRight: "ri:arrow-right-line",
  // 识别方式一路经过的：录音、原生模型、本机转写、润色、成稿
  mic: "ri:mic-line",
  sparkle: "ri:sparkling-2-line",
  chip: "ri:cpu-line",
  magic: "ri:magic-line",
  text: "ri:file-text-line",
  // 识别方式那张图的两条泳道，和离开本机的那一跳
  cloud: "ri:cloud-line",
  laptop: "ri:macbook-line",
  upload: "ri:arrow-up-line",
  // 隐私和小特性
  offline: "ri:wifi-off-line",
  account: "ri:user-forbid-line",
  key: "ri:key-2-line",
  history: "ri:history-line",
  translate: "ri:translate-2",
  palette: "ri:palette-line",
  erase: "ri:delete-bin-line",
  // 品牌（单色，跟着字的颜色走）
  apple: "ri:apple-fill",
  windows: "ri:windows-fill",
  github: "ri:github-fill",
  // 性能一段的硬件厂商（单色，跟着字的颜色走）
  nvidia: "simple-icons:nvidia",
  amd: "simple-icons:amd",
  intel: "simple-icons:intel",
};

/**
 * 字标在 24×24 的方框里只占中间一条：裁到画出来的那一块（浏览器里 getBBox 量的，[左, 上, 宽, 高]），
 * 页面上按高度排，几家标志看起来一样重
 */
const CROP = {
  nvidia: [0, 4.063, 24, 15.874],
  amd: [0, 9.137, 24, 5.726],
  intel: [0, 7.345, 24, 9.311],
};

const API = "https://api.iconify.design";

async function fetchSet(prefix, names) {
  const response = await fetch(`${API}/${prefix}.json?icons=${names.join(",")}`);
  if (!response.ok) throw new Error(`${prefix}：Iconify 回了 ${response.status}`);
  const data = await response.json();
  if (data.not_found?.length) throw new Error(`${prefix} 里没有：${data.not_found.join(", ")}`);
  return data;
}

const byPrefix = new Map();
for (const [local, id] of Object.entries(ICONS)) {
  const [prefix, name] = id.split(":");
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push({ local, name });
}

const out = {};
for (const [prefix, entries] of byPrefix) {
  const data = await fetchSet(
    prefix,
    entries.map(({ name }) => name),
  );
  for (const { local, name } of entries) {
    const icon = data.icons[name];
    const [left, top, width, height] = CROP[local] ?? [
      0,
      0,
      icon.width ?? data.width ?? 24,
      icon.height ?? data.height ?? 24,
    ];
    out[local] = {
      ...(left || top ? { left, top } : {}),
      width,
      height,
      // 同一页里画两次时 id 会撞：给 mask、filter 这些 id 加上本地名字做前缀，引用它们的 url(#…)、href="#…" 跟着改
      body: icon.body
        .replace(/id="([^"]+)"/g, `id="${local}-$1"`)
        .replace(/url\(#([^)]+)\)/g, `url(#${local}-$1)`)
        .replace(/href="#([^"]+)"/g, `href="#${local}-$1"`),
    };
  }
}

const file = join(dirname(fileURLToPath(import.meta.url)), "../src/icons/data.js");
const header = "// 由 scripts/icons.mjs 从 Iconify 生成，别手改。来源和许可见那个脚本的开头\n";
writeFileSync(file, `${header}export const icons = ${JSON.stringify(out, null, 2)};\n`);
console.log(`写好了 ${Object.keys(out).length} 个图标：${file}`);
