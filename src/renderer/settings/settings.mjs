// 设置窗口：选用哪家的模型、填 key、看三项权限、设开机启动。状态都在主进程，这里只负责画出来和转达用户的操作。
// key 只从这里往主进程走一趟，不会从主进程回到页面上。

const $ = (id) => document.getElementById(id);
const describe = (error) => (error instanceof Error ? error.message : String(error));

const keyInput = $("key-input");
const saveButton = $("save-key");
const useButton = $("use-provider");
const keyProblem = $("key-problem");
/** 正在保存或者正在改用时不让重复提交，也不让别处的刷新把按钮重新点亮 */
let saving = false;
/** 现在看着的是哪一家（id）。打开时是正在用的那家；点了别家就看别家的 key，可以改用它 */
let selected = null;
/** 最近一次拿到的状态：点按钮切换看哪一家时不用再问一次主进程 */
let latest = null;

/** 夹在中文里的词：英文开头或结尾的那一侧和汉字之间空一格（"去 Google AI Studio 申请"、"去 OpenAI 开发者平台申请"） */
const spacedInChinese = (text) =>
  `${/^[A-Za-z0-9]/.test(text) ? " " : ""}${text}${/[A-Za-z0-9]$/.test(text) ? " " : ""}`;

/** 0.3 的主进程不报用的是哪一家，那时只有 Gemini */
const GEMINI = { id: "gemini", name: "Gemini", keyEnv: "GEMINI_API_KEY", site: "Google AI Studio", key: null };

/** 不是正在用的那家：只说它有没有 key、在哪（主进程只报来源，不解密） */
function otherKeyText(provider) {
  if (provider.key === "env") return [`环境变量 ${provider.keyEnv} 里有一把，改用时用它。`, "pending"];
  if (provider.key === "stored") return ["已经存着一把。", "pending"];
  return [`还没有填。填一把 ${provider.name} 的 key 就能改用它。`, ""];
}

/** 每家一个按钮。正在用的那家下面写"正在用"，别家写有没有 key */
function renderProviders(providers, currentId) {
  const group = $("providers");
  group.replaceChildren(
    ...providers.map((provider) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "provider";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(provider.id === selected));
      button.dataset.provider = provider.id;
      const name = document.createElement("span");
      name.className = "provider-name";
      name.textContent = provider.name;
      const note = document.createElement("span");
      note.className = "provider-note";
      const inUse = provider.id === currentId;
      note.textContent = inUse ? "正在用" : provider.key ? "有 key" : "没有 key";
      note.dataset.tone = inUse ? "ok" : "";
      button.append(name, note);
      button.addEventListener("click", () => {
        if (selected === provider.id) return;
        selected = provider.id;
        keyInput.value = "";
        showKeyProblem(null);
        showKeyNote(null);
        render(latest);
      });
      return button;
    }),
  );
}

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

  // key 这一块说的是选中的那一家：它的 key 在不在、去哪申请；不是正在用的那家时可以改用它
  const current = setup.provider ?? GEMINI;
  const providers = setup.providers ?? [current];
  if (!providers.some(({ id }) => id === selected)) selected = current.id;
  const provider = providers.find(({ id }) => id === selected);
  const isCurrent = provider.id === current.id;
  // 连着单独启动的服务端时用哪家由那边定，不给选
  $("providers").hidden = !setup.switchable;
  if (setup.switchable) renderProviders(providers, current.id);
  keyInput.setAttribute("aria-label", `${provider.name} API key`);
  $("open-key-page").textContent = `去${spacedInChinese(provider.site)}申请一把`;
  const [text, tone] = isCurrent ? keyText(setup.key, provider) : otherKeyText(provider);
  $("key-state").textContent = text;
  $("key-state").dataset.tone = tone;
  // 别家已经有 key：一点就改用它；没有的话在下面填一把，保存时一起改用
  useButton.hidden = isCurrent || provider.key === null;
  if (!saving) useButton.textContent = `改用 ${provider.name}`;
  useButton.disabled = saving;
  if (!saving) saveButton.textContent = isCurrent ? "保存并验证" : `保存并改用 ${provider.name}`;
  // 一次只有一个主按钮：别家已经有 key 时主要是"改用"，填一把新的退到次要
  saveButton.classList.toggle("primary", useButton.hidden);
  // 环境变量和外部服务端的 key 不归这里管，不提供"删除"
  $("forget-key").hidden = (isCurrent ? setup.key.source : provider.key) !== "stored";
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
  latest = await window.speakmore.getSetup();
  render(latest);
}

function showKeyProblem(message) {
  keyProblem.textContent = message ?? "";
  keyProblem.hidden = !message;
}

/** 改用成功但有话要交代（比如没记进设置、被环境变量盖着） */
function showKeyNote(message) {
  $("key-note").textContent = message ?? "";
  $("key-note").hidden = !message;
}

/**
 * 存 key、改用别家都走这里：一次只做一件，做的时候按钮上写着"验证中…"，做完刷新。
 * @param {HTMLButtonElement} button
 * @param {() => Promise<{ ok: boolean, problem?: string, note?: string }>} action
 */
async function submit(button, action) {
  if (saving) return;
  saving = true;
  const label = button.textContent;
  saveButton.disabled = true;
  useButton.disabled = true;
  button.textContent = "验证中…";
  showKeyProblem(null);
  showKeyNote(null);
  try {
    const result = await action();
    if (result.ok) {
      keyInput.value = "";
      showKeyNote(result.note);
    } else showKeyProblem(result.problem);
  } catch (error) {
    showKeyProblem(`没有成功：${describe(error)}`);
  } finally {
    saving = false;
    button.textContent = label;
    await refresh();
  }
}

// ---------- 用户的操作 ----------

$("key-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = keyInput.value;
  const isCurrent = selected === (latest.provider ?? GEMINI).id;
  // 选中的不是正在用的那家：存这把 key 的同时改用它，验证过才换
  submit(saveButton, () =>
    isCurrent ? window.speakmore.saveKey(value) : window.speakmore.useProvider(selected, value),
  );
});

useButton.addEventListener("click", () => submit(useButton, () => window.speakmore.useProvider(selected)));

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
  const provider = (latest.providers ?? []).find(({ id }) => id === selected) ?? latest.provider ?? GEMINI;
  const inUse = provider.id === (latest.provider ?? GEMINI).id;
  const consequence = inUse ? "删除后要重新填才能继续用。" : "";
  if (!window.confirm(`删除已保存的 ${provider.name} key？${consequence}`)) return;
  await window.speakmore.forgetKey(selected);
  await refresh();
});

$("open-key-page").addEventListener("click", () => window.speakmore.openKeyPage(selected));
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
