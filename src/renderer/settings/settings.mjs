// 设置窗口：填 key、看三项权限、设开机启动。状态都在主进程，这里只负责画出来和转达用户的操作。
// key 只从这里往主进程走一趟，不会从主进程回到页面上。

const $ = (id) => document.getElementById(id);
const describe = (error) => (error instanceof Error ? error.message : String(error));

const keyInput = $("key-input");
const saveButton = $("save-key");
const keyProblem = $("key-problem");
/** 正在保存时不让重复提交，也不让别处的刷新把按钮重新点亮 */
let saving = false;

/** 夹在中文里的词：英文开头或结尾的那一侧和汉字之间空一格（"去 Google AI Studio 申请"、"去 OpenAI 开发者平台申请"） */
const spacedInChinese = (text) =>
  `${/^[A-Za-z0-9]/.test(text) ? " " : ""}${text}${/[A-Za-z0-9]$/.test(text) ? " " : ""}`;

/** 0.3 的主进程不报用的是哪一家，那时只有 Gemini */
const GEMINI = { name: "Gemini", keyEnv: "GEMINI_API_KEY", site: "Google AI Studio" };

function keyText(key, provider) {
  // 启动时够不着的话先用着，如实说还没验证
  const unverified = key.verified === false ? `启动时没连上 ${provider.name}，还没验证这把能不能用。` : "";
  switch (key.state) {
    case "ready":
      if (key.source === "env") {
        return [`这次运行用的是环境变量 ${provider.keyEnv} 里的 key，没有保存。${unverified}`, "ok"];
      }
      if (key.source === "external") return ["现在连的是单独启动的服务端，key 在那边配。", "ok"];
      return unverified ? [`已保存。${unverified}`, "pending"] : ["已保存，验证通过。", "ok"];
    case "checking":
      return ["正在验证…", "pending"];
    case "rejected":
      // 三种情况要做的事不一样：只有最后一种是在下面换一把就能解决的
      if (key.cause === "other") {
        return [
          `验证没通过：${key.problem}。key 未必有问题，先看模型的设置（终端里运行 speakmore model）。`,
          "problem",
        ];
      }
      if (key.source === "env") {
        return [
          `环境变量 ${provider.keyEnv} 里的 key 不能用：${key.problem}。改对它，或者去掉这个环境变量，再重新启动。`,
          "problem",
        ];
      }
      return [`现在这把不能用：${key.problem}`, "problem"];
    case "unreadable":
      return [key.problem, "problem"];
    default:
      return ["还没有填。", "problem"];
  }
}

function permissionText(name, value) {
  if (name === "microphone") {
    if (value === "granted") return ["已授权", "ok", "打开系统设置"];
    // 从没问过时系统设置的列表里还没有这个应用，要先让系统弹一次授权框
    if (value === "not-determined") return ["还没授权", "problem", "授权"];
    return ["没有授权", "problem", "打开系统设置"];
  }
  if (value === null) return ["检查中…", "pending", "打开系统设置"];
  return value ? ["已授权", "ok", "打开系统设置"] : ["没有授权", "problem", "打开系统设置"];
}

function render(setup) {
  const { summary, hotkeyLabel } = setup;
  const status = $("status");
  if (summary.ready) {
    status.dataset.state = "ready";
    $("status-title").textContent = "可以用了";
    $("status-detail").textContent = `点进任意输入框，按一下${hotkeyLabel}开始说话，再按一下结束，文字会贴进去。`;
  } else if (summary.missing.length > 0) {
    status.dataset.state = "incomplete";
    $("status-title").textContent = `还差 ${summary.missing.length} 样`;
    $("status-detail").textContent = `${summary.missing.join("、")}。补齐之后就能用。`;
  } else {
    status.dataset.state = "pending";
    $("status-title").textContent = "正在准备…";
    $("status-detail").textContent = "";
  }
  $("status-degraded").textContent = summary.degraded ?? "";
  $("status-degraded").hidden = summary.degraded === null;

  // key 这一块说的是正在用的那一家：标题、为什么要它、去哪申请
  const provider = setup.provider ?? GEMINI;
  $("key-heading").textContent = `${provider.name} API key`;
  keyInput.setAttribute("aria-label", `${provider.name} API key`);
  $("key-provider").textContent = provider.name;
  $("open-key-page").textContent = `去${spacedInChinese(provider.site)}申请一把`;
  const [text, tone] = keyText(setup.key, provider);
  $("key-state").textContent = text;
  $("key-state").dataset.tone = tone;
  // 环境变量和外部服务端的 key 不归这里管，不提供"删除"
  $("forget-key").hidden = setup.key.source !== "stored";
  const editable = setup.key.source !== "external";
  keyInput.disabled = !editable;
  $("paste-key").disabled = !editable;
  saveButton.disabled = saving || !editable;

  for (const row of document.querySelectorAll("[data-permission]")) {
    const name = row.dataset.permission;
    const [label, rowTone, action] = permissionText(name, setup.permissions[name]);
    const granted = row.querySelector(".granted");
    granted.textContent = label;
    granted.dataset.tone = rowTone;
    row.querySelector("button").textContent = action;
  }

  const openAtLogin = $("open-at-login");
  openAtLogin.checked = setup.openAtLogin.enabled;
  openAtLogin.disabled = !setup.openAtLogin.supported;
  $("open-at-login-hint").hidden = setup.openAtLogin.supported;

  $("data-dir").textContent = setup.home;
}

async function refresh() {
  render(await window.speakmore.getSetup());
}

function showKeyProblem(message) {
  keyProblem.textContent = message ?? "";
  keyProblem.hidden = !message;
}

// ---------- 用户的操作 ----------

$("key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving) return;
  saving = true;
  saveButton.disabled = true;
  saveButton.textContent = "验证中…";
  showKeyProblem(null);
  try {
    const result = await window.speakmore.saveKey(keyInput.value);
    if (result.ok) keyInput.value = "";
    else showKeyProblem(result.problem);
  } catch (error) {
    showKeyProblem(`保存失败：${describe(error)}`);
  } finally {
    saving = false;
    saveButton.textContent = "保存并验证";
    await refresh();
  }
});

$("paste-key").addEventListener("click", async () => {
  const text = (await window.speakmore.readClipboard()).trim();
  if (text === "") {
    showKeyProblem("剪贴板里没有文字");
    return;
  }
  showKeyProblem(null);
  keyInput.value = text;
  keyInput.focus();
});

$("forget-key").addEventListener("click", async () => {
  if (!window.confirm("删除已保存的 key？删除后要重新填才能继续用。")) return;
  await window.speakmore.forgetKey();
  await refresh();
});

$("open-key-page").addEventListener("click", () => window.speakmore.openKeyPage());
$("show-history").addEventListener("click", () => window.speakmore.showHistory());
$("recheck").addEventListener("click", () => window.speakmore.recheckPermissions());

for (const row of document.querySelectorAll("[data-permission]")) {
  row
    .querySelector("button")
    .addEventListener("click", () => window.speakmore.openPrivacySettings(row.dataset.permission));
}

$("open-at-login").addEventListener("change", async (event) => {
  try {
    await window.speakmore.setOpenAtLogin(event.target.checked);
  } catch (error) {
    console.error("开机启动没有设置上", error);
  }
  await refresh();
});

window.speakmore.onSetupChanged(refresh);
await refresh();
