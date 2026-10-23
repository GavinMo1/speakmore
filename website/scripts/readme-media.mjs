// README 用的图：真窗口的截图加上 Mac 窗口的外框（圆角、阴影、红绿灯），再画下载速度对比、厂商标志墙。都出 WebP 两倍图。
//
//   ../node_modules/.bin/electron scripts/readme-media.mjs -- <截图目录> <输出目录>     （在 website/ 下）
//
// 截图目录里是从真 App 用调试端口截的 PNG（两倍图），文件名 <en|zh>-<序号>-<名字>.png：序号 01–09 是首次引导的窗口，
// 其余是主窗口（红绿灯的位置不同，照 src/app/main.mjs 的 frame()）；名字以 settings- 开头的是设置对话框，不画红绿灯。怎么截见 docs/development.md 的"README 的图"。
// 输出目录里有 manifest.json（名字 → 文件、CSS 像素宽高），再用 upload-media.mjs 传到图片桶的 readme/ 下。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const { PROVIDER_ICON_PATHS } = await import(join(ROOT, "src/renderer/shared/provider-icons.mjs"));
const args = process.argv.slice(process.argv.indexOf("--") + 1);
const [shotsDir, out] = args;
const manifest = {};

const LOCALE = { en: "en", zh: "zh-CN" };
// 红绿灯的位置按 src/app/main.mjs 的 frame()
const HUB = { x: 26, y: 24 };
const ONBOARDING = { x: 20, y: 16 };

let page;
async function canvasPage() {
  if (!page) {
    page = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await page.loadURL("data:text/html,<canvas></canvas>");
  }
  return page;
}

/** 截图加外框：透明底、圆角、细边、阴影、红绿灯。出 WebP 和按 CSS 像素算的宽高 */
async function framed(png, lights) {
  const win = await canvasPage();
  const result = await win.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = "data:image/png;base64,${png.toString("base64")}";
    await image.decode();
    const s = 2, pad = 40 * s, r = 12 * s;
    const w = image.naturalWidth, h = image.naturalHeight;
    const canvas = document.querySelector("canvas");
    canvas.width = w + pad * 2;
    canvas.height = h + pad * 2;
    const c = canvas.getContext("2d");
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.save();
    c.shadowColor = "rgba(15, 20, 40, 0.28)";
    c.shadowBlur = 28 * s;
    c.shadowOffsetY = 12 * s;
    c.beginPath(); c.roundRect(pad, pad, w, h, r); c.fillStyle = "#fff"; c.fill();
    c.restore();
    c.save();
    c.beginPath(); c.roundRect(pad, pad, w, h, r); c.clip();
    c.drawImage(image, pad, pad);
    c.restore();
    c.beginPath(); c.roundRect(pad + 0.5 * s, pad + 0.5 * s, w - s, h - s, r); c.lineWidth = s; c.strokeStyle = "rgba(0, 0, 0, 0.16)"; c.stroke();
    const lights = ${JSON.stringify(lights)};
    if (lights) {
      ["#ff5f57", "#febc2e", "#28c840"].forEach((color, i) => {
        c.beginPath();
        c.arc(pad + (lights.x + 6 + i * 20) * s, pad + (lights.y + 6) * s, 6 * s, 0, Math.PI * 2);
        c.fillStyle = color; c.fill();
        c.lineWidth = 0.5 * s; c.strokeStyle = "rgba(0, 0, 0, 0.18)"; c.stroke();
      });
    }
    return { dataUrl: canvas.toDataURL("image/webp", 0.9), width: canvas.width / s, height: canvas.height / s };
  })()`);
  const { dataUrl, width, height } = result;
  return { body: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"), width, height };
}

function save(name, body, width, height) {
  const file = `${name}.webp`;
  writeFileSync(join(out, file), body);
  manifest[name] = { file, width, height };
  console.log(file, `${width}×${height}`, `${Math.round(body.length / 1024)} KB`);
}

/** 一段 HTML 离屏画出来，裁到有内容的地方，两倍图 */
async function render(html, width) {
  const win = new BrowserWindow({
    width: width * 2,
    height: 1400,
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.webContents.setZoomFactor(2);
  await new Promise((done) => setTimeout(done, 900));
  const height = await win.webContents.executeJavaScript(
    "Math.ceil(document.querySelector('main').getBoundingClientRect().height) + 2",
  );
  const image = (await win.webContents.capturePage()).crop({ x: 0, y: 0, width: width * 2, height: height * 2 });
  win.destroy();
  const encoder = await canvasPage();
  const dataUrl = await encoder.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = "data:image/png;base64,${image.toPNG().toString("base64")}";
    await image.decode();
    const canvas = document.querySelector("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const c = canvas.getContext("2d"); c.clearRect(0, 0, canvas.width, canvas.height); c.drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.92);
  })()`);
  return { body: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"), width, height };
}

const COLORS = {
  light: {
    ink: "oklch(0.24 0.014 262)",
    ink2: "oklch(0.47 0.014 262)",
    card: "oklch(0.985 0.002 262)",
    border: "oklch(0.9 0.006 262)",
    track: "oklch(0.95 0.005 262)",
    primary: "oklch(0.47 0.15 262)",
    glow: "oklch(0.5 0.1 200)",
    dim: "oklch(0.78 0.012 262)",
  },
  dark: {
    ink: "oklch(0.94 0.005 262)",
    ink2: "oklch(0.72 0.012 262)",
    card: "oklch(0.24 0.012 262)",
    border: "oklch(0.34 0.014 262)",
    track: "oklch(0.29 0.014 262)",
    primary: "oklch(0.7 0.13 262)",
    glow: "oklch(0.75 0.1 195)",
    dim: "oklch(0.5 0.012 262)",
  },
};
const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif`;

// 在作者的网络（国内）上实测：同一个 850 MB 的文件，每个源用 curl 下 40 秒、两轮，取平均（字节/秒 ÷ 10^6）。
// 魔搭、hf-mirror 是 2026-10-20 量的（同一时间老的 COS 国内源是 8.45、8.73）；Hugging Face 那天走了代理，
// 不代表国内直连，沿用 2026-10-17 直连量的
const SPEED = [
  { id: "cn", mbps: (9.94 + 9.76) / 2 },
  { id: "hfmirror", mbps: (1.61 + 1.6) / 2 },
  { id: "hf", mbps: (0.675294 + 0.721621) / 2 },
];
const SPEED_TEXT = {
  en: {
    title: "Downloading the on-device model",
    sub: "Qwen3-ASR 0.6B · 850 MB",
    cn: "China mirror (ModelScope)",
    hfmirror: "hf-mirror.com",
    hf: "Hugging Face",
    min: (m) => (m < 2 ? `${m.toFixed(1)} min` : `${Math.round(m)} min`),
    note: "Measured from mainland China, two 40-second runs per source (October 2026)",
  },
  zh: {
    title: "下载本机模型",
    sub: "Qwen3-ASR 0.6B · 850 MB",
    cn: "国内源（魔搭）",
    hfmirror: "hf-mirror.com",
    hf: "Hugging Face",
    min: (m) => (m < 2 ? `${m.toFixed(1)} 分钟` : `${Math.round(m)} 分钟`),
    note: "2026 年 10 月在国内实测，每个源下 40 秒、测两轮取平均",
  },
};

function speedHtml(lang, scheme) {
  const t = SPEED_TEXT[lang];
  const k = COLORS[scheme];
  const max = SPEED[0].mbps;
  const rows = SPEED.map(({ id, mbps }, i) => {
    const minutes = 850.423456 / mbps / 60;
    const best = i === 0;
    return `<div class="row">
      <div class="name ${best ? "best" : ""}">${t[id]}</div>
      <div class="track"><div class="bar ${best ? "best" : ""}" style="width:${Math.max(3, (mbps / max) * 100)}%"></div></div>
      <div class="num ${best ? "best" : ""}">${t.min(minutes)}</div>
      <div class="speed">${mbps.toFixed(1)} MB/s</div>
    </div>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent;font-family:${FONT};-webkit-font-smoothing:antialiased}
    main{width:720px;box-sizing:border-box;padding:28px 32px 22px;border-radius:20px;background:${k.card};border:1px solid ${k.border};color:${k.ink}}
    h1{margin:0;font-size:20px;font-weight:650;letter-spacing:-0.01em}
    .sub{margin-top:4px;font-size:14px;color:${k.ink2}}
    .rows{margin-top:22px;display:grid;gap:14px}
    .row{display:grid;grid-template-columns:200px 1fr 84px 82px;align-items:center;gap:14px}
    .name{font-size:15px;color:${k.ink2}} .name.best{color:${k.ink};font-weight:600}
    .track{height:14px;border-radius:7px;background:${k.track};overflow:hidden}
    .bar{height:100%;border-radius:7px;background:${k.dim}} .bar.best{background:linear-gradient(90deg,${k.primary},${k.glow})}
    .num{text-align:right;font-size:18px;font-weight:650;font-variant-numeric:tabular-nums;color:${k.ink2}} .num.best{color:${k.ink}}
    .speed{text-align:right;font-size:13px;color:${k.ink2};font-variant-numeric:tabular-nums}
    .note{margin-top:20px;font-size:12px;color:${k.ink2}}
  </style></head><body><main><h1>${t.title}</h1><div class="sub">${t.sub}</div><div class="rows">${rows}</div><div class="note">${t.note}</div></main></body></html>`;
}

// 标志墙：按 README 里的说法列，名字跟着语言
const BRANDS = [
  { icon: "gemini", en: "Gemini", zh: "Gemini" },
  { icon: "openai", en: "OpenAI", zh: "OpenAI" },
  { icon: "qwen", en: "Qwen", zh: "通义千问" },
  { icon: "bailian", en: "Bailian", zh: "阿里云百炼" },
  { icon: "deepseek", en: "DeepSeek", zh: "DeepSeek" },
  { icon: "kimi", en: "Kimi", zh: "Kimi" },
  { icon: "zhipu", en: "Zhipu GLM", zh: "智谱 GLM" },
  { icon: "minimax", en: "MiniMax", zh: "MiniMax" },
  { icon: "funaudiollm", en: "SenseVoice", zh: "SenseVoice" },
  { icon: "custom", en: "OpenAI-compatible", zh: "OpenAI 兼容" },
];

function svg(id) {
  const paths = PROVIDER_ICON_PATHS[id];
  const layers = Array.isArray(paths) ? paths : [{ d: paths }];
  return `<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">${layers
    .map(({ d, opacity = 1, rule = "nonzero" }) => `<path d="${d}" fill-opacity="${opacity}" fill-rule="${rule}"/>`)
    .join("")}</svg>`;
}

function logosHtml(lang, scheme) {
  const k = COLORS[scheme];
  const tiles = BRANDS.map(
    (b) => `<div class="brand"><div class="tile">${svg(b.icon)}</div><div class="label">${b[lang]}</div></div>`,
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent;font-family:${FONT};-webkit-font-smoothing:antialiased}
    main{width:860px;display:grid;grid-template-columns:repeat(5,1fr);row-gap:22px;padding:6px 0}
    .brand{display:flex;flex-direction:column;align-items:center;gap:10px}
    .tile{width:64px;height:64px;border-radius:16px;display:grid;place-items:center;background:${k.card};border:1px solid ${k.border};color:${k.ink};box-shadow:0 1px 2px rgba(0,0,0,.06)}
    .label{font-size:14px;color:${k.ink2};font-weight:500}
  </style></head><body><main>${tiles}</main></body></html>`;
}

app.dock?.hide();
// 窗口一个个开了又关：Electron 默认在最后一个窗口关掉时退出，只画测速图和标志墙（截图目录是空的）时，
// 画完一张关掉、转码的窗口还没开，就会在中间退出、后面的加载全失败。最后由这里自己 app.quit()
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  mkdirSync(out, { recursive: true });
  for (const file of readdirSync(shotsDir)
    .filter((f) => f.endsWith(".png"))
    .sort()) {
    const [, lang, rest] = file.match(/^(en|zh)-\d+-(.+)\.png$/);
    // 序号 01–09 是首次引导的窗口：红绿灯的位置不同，名字前面加 onboarding-。
    // 设置是主窗口里的对话框，截的只是它那一块（settings-…），不是一个窗口，不画红绿灯
    const onboarding = /^(en|zh)-0\d-/.test(file);
    const lights = onboarding ? ONBOARDING : rest.startsWith("settings-") ? null : HUB;
    const name = `${onboarding ? "onboarding-" : ""}${rest}.${LOCALE[lang]}`;
    const png = readFileSync(join(shotsDir, file));
    const { body, width, height } = await framed(png, lights);
    save(name, body, width, height);
  }
  for (const lang of ["en", "zh"]) {
    for (const scheme of ["light", "dark"]) {
      const speed = await render(speedHtml(lang, scheme), 720);
      save(`download-speed-${scheme}.${LOCALE[lang]}`, speed.body, speed.width, speed.height);
      const logos = await render(logosHtml(lang, scheme), 860);
      save(`vendors-${scheme}.${LOCALE[lang]}`, logos.body, logos.width, logos.height);
    }
  }
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`共 ${Object.keys(manifest).length} 张：${out}`);
  app.quit();
});
