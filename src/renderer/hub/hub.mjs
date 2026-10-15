import { createHistory } from "./history.mjs";
import { createHome } from "./home.mjs";
import { createSettings } from "./settings.mjs";

// 主窗口：对应原版的 hub.html。左边侧栏切换首页和历史记录，设置是盖在上面的对话框。
// 数据都在主进程：有新记录、记了新的账时它通知这里重读；能不能用、还差什么变了时也一样。

const $ = (id) => document.getElementById(id);
const ROUTES = ["home", "history"];

const home = createHome();
const history = createHistory();
const settings = createSettings({ refresh: refreshSetup });

/** 最近一次拿到的状态：横幅、设置对话框都按它画 */
let setup = null;

function navigate(route) {
  const name = ROUTES.includes(route) ? route : "home";
  for (const page of document.querySelectorAll(".page")) page.hidden = page.dataset.route !== name;
  for (const item of document.querySelectorAll(".nav-item")) {
    if (item.dataset.route === name) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  document.querySelector(".content").scrollTop = 0;
  document.querySelector(".content").removeAttribute("data-scrolled");
}

/** 顶上那一条：还差什么才能用，或者能用但打了折扣。准备中、都齐了时不出现 */
function renderBanner(current) {
  const { summary } = current;
  const banner = $("banner");
  if (summary.missing.length > 0) {
    banner.dataset.tone = "problem";
    $("banner-text").textContent = `还差：${summary.missing.join("、")}`;
  } else if (summary.degraded !== null) {
    banner.dataset.tone = "soft";
    $("banner-text").textContent = summary.degraded;
  } else {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
}

async function refreshSetup() {
  setup = await window.speakmore.getSetup();
  renderBanner(setup);
  settings.render(setup);
  return setup;
}

async function refreshData() {
  try {
    const [rows, usage, insights, app] = await Promise.all([
      window.speakmore.listHistory(),
      window.speakmore.usageReport(),
      window.speakmore.insights(),
      window.speakmore.appInfo(),
    ]);
    home.render({ insights, usage, app });
    history.render({ rows, app });
  } catch (error) {
    console.error("读历史失败", error);
    history.showError(error instanceof Error ? error.message : String(error));
  }
}

// ---------- 用户的操作 ----------

for (const item of document.querySelectorAll(".nav-item")) {
  item.addEventListener("click", () => navigate(item.dataset.route));
}
$("open-settings").addEventListener("click", () => settings.open("general"));
$("open-about").addEventListener("click", () => settings.open("about"));
$("banner-action").addEventListener("click", () => settings.open("auto"));
// 往下滚了，最上面那条拖窗口的地方变成玻璃
const content = document.querySelector(".content");
content.addEventListener("scroll", () => content.toggleAttribute("data-scrolled", content.scrollTop > 4), {
  passive: true,
});

// ---------- 主进程来的 ----------

window.speakmore.onHistoryChanged(refreshData);
window.speakmore.onSetupChanged(refreshSetup);
// 菜单栏、命令行要打开某一页（"显示历史记录"、"设置…"）
window.speakmore.onNavigate(({ route, pane }) => {
  if (route) navigate(route);
  if (pane) settings.open(pane);
});

// 第一次打开时要去哪一页，主进程写在地址里
const params = new URLSearchParams(location.search);
navigate(params.get("route") ?? "home");
await Promise.all([refreshSetup(), refreshData()]);
if (params.get("pane")) settings.open(params.get("pane"));
