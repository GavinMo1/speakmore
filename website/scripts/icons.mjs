// 从 Iconify 取页面用到的图标，写成 src/icons/data.js。加图标：在下面登记一行，再跑 npm run icons。
// 取下来的 SVG 直接打进页面，不在访客打开时再去 Iconify 要：少一个外部依赖，也不往第三方报访客的来路。
//
// 界面图标只用 Remix Icon（ri，Apache-2.0）一套；各家应用的标志用 SVG Logos（logos，CC0）和 theSVG（thesvg-color，MIT），
// Intel 的标志用 Simple Icons（simple-icons，CC0）。
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 页面里的名字 → Iconify 里的 "图标集:名字" */
const ICONS = {
  // 界面
  terminal: "ri:terminal-box-line",
  copy: "ri:file-copy-line",
  check: "ri:check-line",
  lock: "ri:lock-2-line",
  translate: "ri:translate-2",
  // 品牌（单色，跟着字的颜色走）
  apple: "ri:apple-fill",
  intel: "simple-icons:intel",
  github: "ri:github-fill",
  openai: "ri:openai-fill",
  // 品牌（原色）
  geminiColor: "thesvg-color:gemini",
  slack: "logos:slack-icon",
  notion: "logos:notion-icon",
  vscode: "logos:visual-studio-code",
  chrome: "logos:chrome",
  wechat: "thesvg-color:wechat",
  obsidian: "logos:obsidian-icon",
  figma: "logos:figma",
  telegram: "logos:telegram",
  gmail: "logos:google-gmail",
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
    out[local] = {
      width: icon.width ?? data.width ?? 24,
      height: icon.height ?? data.height ?? 24,
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
