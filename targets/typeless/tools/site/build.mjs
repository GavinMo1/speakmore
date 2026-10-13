#!/usr/bin/env node
// 把 README.md 和 docs/*.md 生成一份单文件 HTML 阅读页。
//
//   node tools/site/build.mjs            → _work/site/index.html
//
// 全部文档排在同一页里，所以浏览器自带的查找能搜遍所有篇目。
// 文字离线可读；Mermaid 图在打开时从 cdnjs 加载渲染，断网时显示图的源码。
// 依赖 markdown-it，装在 _work/tooling（见 README 的"复现"）。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const outFile = join(root, "_work/site/index.html");
const MERMAID_URL = "https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.4.0/mermaid.min.js";

let MarkdownIt;
try {
  MarkdownIt = createRequire(join(root, "_work/tooling/package.json"))("markdown-it");
} catch (error) {
  console.error("找不到 markdown-it：cd _work/tooling && npm i markdown-it@14.1.0");
  console.error(String(error.message));
  process.exit(1);
}

// ---------- 颜色：只在这里定义一次，CSS 变量和 Mermaid 主题都从它生成 ----------

// [亮度, 色度, 色相]，OKLCH。中性色都朝主色的色相偏一点，不用纯灰。
const TOKENS = {
  light: {
    bg: [1, 0, 0],
    surface: [0.975, 0.005, 252],
    raised: [0.958, 0.007, 252],
    border: [0.895, 0.01, 252],
    "border-strong": [0.8, 0.014, 252],
    ink: [0.25, 0.02, 252],
    "ink-2": [0.46, 0.02, 252],
    primary: [0.478, 0.136, 251.8],
    "primary-weak": [0.95, 0.028, 252],
  },
  dark: {
    bg: [0.185, 0.012, 252],
    surface: [0.215, 0.014, 252],
    raised: [0.255, 0.016, 252],
    border: [0.32, 0.018, 252],
    "border-strong": [0.43, 0.02, 252],
    ink: [0.93, 0.008, 252],
    "ink-2": [0.74, 0.014, 252],
    primary: [0.78, 0.105, 252],
    "primary-weak": [0.3, 0.06, 252],
  },
};

function oklchToRgb([l, c, h]) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  return linear.map((v) => {
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, s));
  });
}

const toHex = (lch) =>
  "#" + oklchToRgb(lch).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

function contrast(lchA, lchB) {
  const luminance = (lch) => {
    const [r, g, b] = oklchToRgb(lch).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(lchA), luminance(lchB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// 正文、次要文字、链接对各层背景都要过 4.5:1，不过就不出页面
function checkContrast() {
  const failures = [];
  for (const [theme, t] of Object.entries(TOKENS)) {
    for (const fg of ["ink", "ink-2", "primary"]) {
      for (const bg of ["bg", "surface", "raised", "primary-weak"]) {
        const ratio = contrast(t[fg], t[bg]);
        if (ratio < 4.5) failures.push(`${theme}: ${fg} / ${bg} = ${ratio.toFixed(2)}`);
      }
    }
  }
  if (failures.length) {
    throw new Error("对比度不足 4.5:1：\n  " + failures.join("\n  "));
  }
}

const cssVars = (t) =>
  Object.entries(t).map(([name, [l, c, h]]) => `--${name}: oklch(${l} ${c} ${h});`).join(" ");

// Mermaid 不认 oklch，给它十六进制
const mermaidTheme = (t) => ({
  background: toHex(t.bg),
  primaryColor: toHex(t.raised),
  primaryTextColor: toHex(t.ink),
  primaryBorderColor: toHex(t["border-strong"]),
  secondaryColor: toHex(t.surface),
  tertiaryColor: toHex(t.surface),
  lineColor: toHex(t["ink-2"]),
  textColor: toHex(t.ink),
  mainBkg: toHex(t.raised),
  nodeBorder: toHex(t["border-strong"]),
  clusterBkg: toHex(t.surface),
  clusterBorder: toHex(t.border),
  edgeLabelBackground: toHex(t.bg),
  actorBkg: toHex(t.raised),
  actorBorder: toHex(t["border-strong"]),
  actorTextColor: toHex(t.ink),
  actorLineColor: toHex(t["border-strong"]),
  signalColor: toHex(t["ink-2"]),
  signalTextColor: toHex(t.ink),
  labelBoxBkgColor: toHex(t["primary-weak"]),
  labelBoxBorderColor: toHex(t["border-strong"]),
  labelTextColor: toHex(t.ink),
  loopTextColor: toHex(t.ink),
  noteBkgColor: toHex(t["primary-weak"]),
  noteTextColor: toHex(t.ink),
  noteBorderColor: toHex(t["border-strong"]),
  activationBkgColor: toHex(t.surface),
  sequenceNumberColor: toHex(t.bg),
});

// ---------- 文档清单 ----------

const GROUPS = [
  ["从这里开始", ["readme", "00"]],
  ["包与进程", ["01", "02", "03"]],
  ["主链路", ["04", "05", "06", "07"]],
  ["数据与抓包", ["08", "09"]],
  ["专题", ["10", "11", "12", "13", "14", "15"]],
  ["附录", ["90", "91"]],
];

function loadDocs() {
  const docs = [{ key: "readme", file: "README.md", path: join(root, "README.md") }];
  for (const name of readdirSync(join(root, "docs")).sort()) {
    const match = /^(\d\d)-.*\.md$/.exec(name);
    if (match) docs.push({ key: match[1], file: `docs/${name}`, path: join(root, "docs", name) });
  }
  const grouped = new Set(GROUPS.flatMap(([, keys]) => keys));
  const orphans = docs.filter((doc) => !grouped.has(doc.key)).map((doc) => doc.file);
  if (orphans.length) {
    throw new Error("这些文档没有归进 GROUPS，目录里会漏掉：" + orphans.join("、"));
  }
  for (const doc of docs) {
    doc.id = doc.key === "readme" ? "d-readme" : `d${doc.key}`;
    doc.source = readFileSync(doc.path, "utf8");
  }
  return docs;
}

// ---------- Markdown → HTML ----------

const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 与 GitHub 的标题锚点规则一致，文档里现有的 #锚点 才能原样对上
const slugify = (text) =>
  text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-");

function renderDoc(doc, docs, problems) {
  const md = new MarkdownIt({ html: false, linkify: false });
  const used = new Map();
  const sections = [];
  doc.ids = new Set([doc.id]);

  const headingText = (inline) =>
    inline.children.filter((t) => t.type === "text" || t.type === "code_inline").map((t) => t.content).join("");

  md.renderer.rules.heading_open = (tokens, index) => {
    const token = tokens[index];
    const level = Number(token.tag.slice(1));
    const text = headingText(tokens[index + 1]);
    if (level === 1) {
      // 每篇的一级标题降为页面的二级；开头的编号拆出来单独排
      const match = /^(\d\d)\s+(.*)$/.exec(text);
      doc.title = match ? match[2] : text;
      doc.number = match ? match[1] : "";
      tokens[index + 1].children = [];
      const number = doc.number ? `<span class="doc-num">${doc.number}</span>` : "";
      return `<h2 id="${doc.id}" class="doc-title" tabindex="-1">${number}${escapeHtml(doc.title)}`;
    }
    let slug = slugify(text);
    const seen = used.get(slug) ?? 0;
    used.set(slug, seen + 1);
    if (seen) slug += `-${seen}`;
    const id = `${doc.id}-${slug}`;
    doc.ids.add(id);
    if (level <= 3) sections.push({ id, text, level });
    return `<h${level + 1} id="${escapeHtml(id)}" tabindex="-1">`;
  };
  md.renderer.rules.heading_close = (tokens, index) => `</h${Number(tokens[index].tag.slice(1)) + 1}>\n`;

  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const href = token.attrGet("href") ?? "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
    } else {
      const resolved = resolveLink(href, doc, docs);
      if (resolved) token.attrSet("href", resolved);
      else problems.push(`${doc.file}：认不出的链接 ${href}`);
    }
    return self.renderToken(tokens, index, options);
  };

  md.renderer.rules.table_open = () => '<div class="table-wrap" tabindex="0" role="group" aria-label="表格"><table>\n';
  md.renderer.rules.table_close = () => "</table></div>\n";

  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const language = token.info.trim();
    const code = escapeHtml(token.content.replace(/\n$/, ""));
    if (language === "mermaid") {
      return `<figure class="diagram"><div class="diagram-out" aria-hidden="true"></div><pre class="diagram-src"><code>${code}</code></pre></figure>\n`;
    }
    return `<pre class="code"${language ? ` data-lang="${escapeHtml(language)}"` : ""}><code>${code}</code></pre>\n`;
  };

  doc.html = md.render(doc.source);
  doc.sections = sections;
  if (!doc.title) throw new Error(`${doc.file} 没有一级标题`);
}

function resolveLink(href, doc, docs) {
  const [path, rawFragment = ""] = href.split("#");
  const fragment = rawFragment ? decodeURIComponent(rawFragment).toLowerCase() : "";
  let target = doc;
  if (path) {
    const name = path.replace(/^\.\//, "").replace(/^docs\//, "");
    target = docs.find((d) => d.file === name || d.file === `docs/${name}`);
    if (!target) return null;
  }
  return fragment ? `#${target.id}-${fragment}` : `#${target.id}`;
}

// ---------- 页面 ----------

function buildStamp() {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const commit = git("rev-parse", "--short", "HEAD");
  const dirty = git("status", "--porcelain", "--", "docs", "README.md") !== "";
  const date = new Date().toISOString().slice(0, 10);
  return `${date} 生成，对应提交 ${commit}${dirty ? "（另有未提交的改动）" : ""}`;
}

function page(docs) {
  const byKey = new Map(docs.map((doc) => [doc.key, doc]));
  const label = (doc) => (doc.key === "readme" ? "导读" : doc.title);

  const sidebar = GROUPS.map(([name, keys]) => {
    const items = keys
      .filter((key) => byKey.has(key))
      .map((key) => {
        const doc = byKey.get(key);
        const number = doc.number ? `<span class="nav-num">${doc.number}</span>` : `<span class="nav-num"></span>`;
        return `<li><a href="#${doc.id}" data-doc="${doc.id}">${number}<span>${escapeHtml(label(doc))}</span></a></li>`;
      })
      .join("");
    return `<section class="nav-group"><h2>${name}</h2><ul>${items}</ul></section>`;
  }).join("\n");

  const rail = docs
    .map((doc) => {
      const items = doc.sections
        .map((s) => `<li class="lv${s.level}"><a href="#${escapeHtml(s.id)}">${escapeHtml(s.text)}</a></li>`)
        .join("");
      return `<nav class="rail-doc" data-doc="${doc.id}" aria-label="本篇小节" hidden><p class="rail-title">${escapeHtml(label(doc))}</p><ol>${items}</ol></nav>`;
    })
    .join("\n");

  const articles = docs
    .map((doc) => `<article class="doc" data-doc="${doc.id}">\n${doc.html}</article>`)
    .join("\n");

  const css = readFileSync(join(here, "style.css"), "utf8");
  const js = readFileSync(join(here, "app.js"), "utf8");
  const themes = JSON.stringify({ light: mermaidTheme(TOKENS.light), dark: mermaidTheme(TOKENS.dark) });

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Typeless 逆向笔记</title>
<link rel="icon" href="data:,">
<style>
:root { color-scheme: light; ${cssVars(TOKENS.light)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; ${cssVars(TOKENS.dark)} } }
:root[data-theme="dark"] { color-scheme: dark; ${cssVars(TOKENS.dark)} }
${css}
</style>
<script>
// 在首次绘制前套上记住的主题，避免闪一下。读不到存储（隐私模式）就跟随系统，不算错误
try { const saved = localStorage.getItem("theme"); if (saved) document.documentElement.dataset.theme = saved; } catch (error) {}
</script>
</head>
<body>
<a class="skip" href="#main">跳到正文</a>
<header class="topbar">
  <button class="nav-toggle" type="button" aria-controls="sidebar" aria-expanded="false">目录</button>
  <a class="brand" href="#d-readme">Typeless 2.8.1 逆向笔记</a>
  <span class="stamp">${escapeHtml(buildStamp())}</span>
  <button class="theme-toggle" type="button" aria-label="切换深浅色"></button>
</header>
<div class="layout">
  <nav id="sidebar" class="sidebar" aria-label="文档目录">
${sidebar}
  </nav>
  <main id="main">
${articles}
  </main>
  <aside class="rail">
${rail}
  </aside>
</div>
<script>window.DIAGRAM_THEMES = ${themes}; window.MERMAID_URL = ${JSON.stringify(MERMAID_URL)};</script>
<script>
${js}
</script>
</body>
</html>
`;
}

// ---------- 主流程 ----------

checkContrast();
const docs = loadDocs();
const problems = [];
for (const doc of docs) renderDoc(doc, docs, problems);

// 每个站内链接都必须落在一个真实存在的标题上
const allIds = new Set(docs.flatMap((doc) => [...doc.ids]));
for (const doc of docs) {
  for (const match of doc.html.matchAll(/<a href="#([^"]+)"/g)) {
    const id = match[1].replace(/&amp;/g, "&");
    if (!allIds.has(id)) problems.push(`${doc.file}：链接指向不存在的标题 #${id}`);
  }
}
if (problems.length) {
  console.error("发现 " + problems.length + " 处问题，未生成页面：\n  " + problems.join("\n  "));
  process.exit(1);
}

mkdirSync(dirname(outFile), { recursive: true });
const html = page(docs);
writeFileSync(outFile, html);
const diagrams = (html.match(/class="diagram"/g) ?? []).length;
console.log(`已生成 ${outFile}`);
console.log(`文档 ${docs.length} 篇，标题锚点 ${allIds.size} 个，Mermaid 图 ${diagrams} 张，${(html.length / 1024).toFixed(0)} KB`);
