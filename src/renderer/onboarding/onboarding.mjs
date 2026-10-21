import { fillSelect, h, progressBadge, svg } from "../shared/dom.mjs";
import { keycapOf, localize, t } from "../shared/i18n.mjs";
import { meterLevels, openMicrophone } from "../shared/level-meter.mjs";
import { providerIcon } from "../shared/provider-icons.mjs";
import { describeError, permissionGranted } from "../shared/setup-text.mjs";
import { createKeyPanel } from "./key-panel.mjs";
import { changesOf, hasKey, inEffect, localModelOf, needsOf, planOf, readinessOf, vendorsFor, WAYS } from "./plan.mjs";
import { firstStepOf, groupStates, STEPS, startStep, stepDone } from "./steps.mjs";

// 首次引导：选识别方式 → 准备（下本机模型、填密钥）→ 授权 → 测麦克风 → 测快捷键 → 真说一句 → 完成。
// 哪一步都能退回去、往前跳，没做完的也能跳过，进去再配：数据隐私不要密钥，什么都不配也能先进去看看。
// 点了哪种方式、哪一家就当场换上（app/modes.mjs 的 switchMode 不验 key、不等下载）；还差的照实写出来，补齐了自己就能用。
// 状态都在主进程；这里管走到哪一步、每一步怎么画。走完了主进程关掉这个窗口、打开主窗口。

const $ = (id) => document.getElementById(id);
/** 测麦克风时画几根条，中间的高、两边的矮 */
const METER_BARS = [0.45, 0.7, 0.9, 1, 0.9, 0.7, 0.45];
const ICONS = { native: "i-sparkles", local: "i-wand-sparkles", private: "i-shield-check" };

// 页面上写死的字先按界面语言填上
localize();

let setup = null;
let step = null;
/** 现在用的这一套：{ mode, native, polish }（plan.mjs）。照设置；正在换的时候先画成点的那一套 */
let plan = null;
/** 正在换的有几次（连着点了好几下时一次一次排着换） */
let applying = 0;
/** 点了第几次：只有最后点的那次说成没成 */
let attempts = 0;
/** 最后点的那次没换成：{ plan, problem }。点"重试"再换一次；换了别的、存了新密钥就不再说 */
let failure = null;
/** 准备那一步的密钥那一块：{ mode, section, panel }，换了方式就换一块 */
let keySlot = null;
/** 下载没发起成（磁盘不够这类）：{ model, problem }。下载中途失败的由主进程记在模型的状态里 */
let downloadProblem = null;
/** 选识别方式那三行：只建一次，之后只改状态 */
const wayRows = new Map();

async function refresh() {
  setup = await window.speakmore.getSetup();
  if (applying === 0) plan = planOf(setup);
  render();
  return setup;
}

// ---------- 换上点的那一套 ----------

/**
 * 点了一种方式或一家：当场换上，带着那种方式的设置（plan.mjs 的 changesOf）。已经是这一套就什么都不做；
 * 前一下还在换时照样发：手里的状态还没跟上，看不出是不是已经是这一套
 */
async function changePlan(next) {
  const wanted = { ...plan, ...next };
  const ticket = ++attempts;
  failure = null;
  plan = wanted;
  if (applying === 0 && inEffect(wanted, setup)) {
    render();
    return;
  }
  applying += 1;
  render();
  let result;
  try {
    result = await window.speakmore.setMode(wanted.mode, changesOf(wanted, setup));
  } catch (error) {
    result = { ok: false, problem: describeError(error) };
  }
  applying -= 1;
  if (ticket === attempts) failure = result.ok ? null : { plan: wanted, problem: result.problem };
  await refresh();
}

// ---------- 走到哪一步 ----------

/** 离开某一步时要收拾的：关麦克风、不再截热键 */
const leave = {
  microphone: () => stopMeter(),
  hotkey: () => window.speakmore.captureHotkey(false),
};
/** 进入某一步时要做的 */
const enter = {
  microphone: () => startMeter(),
  // 测快捷键时热键不去开悬浮条，只送到这里
  hotkey: () => window.speakmore.captureHotkey(true),
  try: () => $("try-text").focus(),
};

function go(next) {
  if (next === step) return;
  leave[step]?.();
  step = next;
  for (const section of document.querySelectorAll(".step")) section.hidden = section.dataset.step !== step;
  $("stage").scrollTop = 0;
  enter[step]?.();
  render();
}

const goBy = (offset) => go(STEPS[Math.min(STEPS.length - 1, Math.max(0, STEPS.indexOf(step) + offset))]);

// ---------- 画 ----------

const modeName = (mode) => t(`plaza.modes.${mode}`);
const transcriber = (id) => setup.local.transcribers.find((model) => model.id === id);

/** 体积：1 GB 以上写一位小数的 GB，以下写整数 MB */
const sizeText = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

/** "Qwen3-ASR 0.6B (Q8_0)" 拆成型号和量化档 */
function nameParts(name) {
  const match = /^(.*?) \((.+)\)$/.exec(name);
  return match ? [match[1], match[2]] : [name, null];
}

/** 品牌图标的底座：认识的家用它的图标，本机模型用笔记本，不认识的用一朵云 */
const tile = (id, className = "logo-tile") =>
  h("span", { class: className }, (id && providerIcon(id)) ?? svg(id === "local" ? "i-laptop" : "i-cloud"));

/** 一行里要什么：带图标的短语 */
const need = (icon, text) => h("span", { class: "need" }, svg(icon), h("span", { text }));

function renderWays() {
  if (wayRows.size === 0) {
    for (const mode of WAYS) {
      const needs = h("span", { class: "needs" });
      const button = h(
        "button",
        { type: "button", class: "choice", role: "radio", onclick: () => changePlan({ mode }) },
        h("span", { class: "choice-icon" }, svg(ICONS[mode])),
        h(
          "span",
          { class: "choice-body" },
          h("span", { class: "choice-name", text: modeName(mode) }),
          h("span", { class: "choice-desc", text: t(`home.mode.desc.${mode}`) }),
          needs,
        ),
        h(
          "span",
          {
            class: "brands",
            title: vendorsFor(setup, mode)
              .map(({ id }) => t(`providers.${id}.name`))
              .join(" · "),
          },
          ...(mode === "private"
            ? [tile("local", "mini-tile")]
            : vendorsFor(setup, mode).map(({ id }) => tile(id, "mini-tile"))),
        ),
        h("span", { class: "radio-mark" }, svg("i-check")),
      );
      wayRows.set(mode, { button, needs });
    }
    $("ways").replaceChildren(...[...wayRows.values()].map(({ button }) => button));
  }
  for (const [mode, { button, needs }] of wayRows) {
    button.setAttribute("aria-checked", String(plan.mode === mode));
    button.disabled = !setup.switchable;
    const local = mode === "native" ? null : transcriber(localModelOf(setup, mode));
    const size = local && (local.installed ? t("onboarding.prepare.model.ready") : sizeText(local.bytes));
    needs.replaceChildren(
      ...(local ? [need("i-laptop", t("onboarding.way.local", { size }))] : []),
      mode === "private" ? need("i-lock", t("onboarding.way.offline")) : need("i-key-round", t("onboarding.way.key")),
    );
  }
  $("way-note").replaceChildren(
    svg("i-circle-alert"),
    t(setup.switchable ? "onboarding.way.note" : "home.mode.locked"),
  );
}

/**
 * 正在用的这种方式第一跳交给云端（只能在模型页配）：那一跳 { maker, platform, name }（app/model-plaza.mjs 的 hops）；
 * 否则是 null，第一跳是本机模型
 */
function cloudFirstHop() {
  if (plan.mode === "native" || plan.mode !== setup.mode.value) return null;
  const first = setup.plaza.ways[plan.mode]?.hops?.[0];
  return first && first.platform !== "local" ? first : null;
}

/** 一路经过谁：录音 → 各个模型 → 文字 */
function renderRoute() {
  const arrow = () => h("li", { class: "route-arrow", "aria-hidden": "true" }, svg("i-chevron-right"));
  const end = (icon, text) => h("li", { class: "route-end" }, svg(icon), h("span", { text }));
  const hop = (id, text, local) =>
    h(
      "li",
      { class: "route-hop" },
      tile(id, "mini-tile"),
      h("span", { text }),
      local && h("span", { class: "tag", "data-tone": "accent", text: t("onboarding.prepare.route.local") }),
    );
  const hops = [];
  const cloud = cloudFirstHop();
  if (cloud) hops.push(hop(cloud.maker ?? cloud.platform, cloud.name, false));
  else if (plan.mode !== "native") {
    const model = transcriber(localModelOf(setup, plan.mode));
    hops.push(hop(model.maker ?? "local", nameParts(model.name)[0], true));
  }
  if (plan.mode === "native") hops.push(hop(plan.native, t(`providers.${plan.native}.name`), false));
  if (plan.mode === "local") hops.push(hop(plan.polish, t(`providers.${plan.polish}.name`), false));
  $("route").replaceChildren(
    end("i-mic", t("onboarding.prepare.route.audio")),
    ...hops.flatMap((item) => [arrow(), item]),
    arrow(),
    end("i-letter-text", t("onboarding.prepare.route.text")),
  );
}

/** 这一套现在怎样：启用中、没换成（带重试）、已启用；已经换上但还差东西时说一句，差的下面各块自己写着 */
function renderStatus() {
  const box = $("plan-status");
  const badge = (tone, icon, text) =>
    h(
      "span",
      { class: "badge", "data-tone": tone },
      svg(icon, icon === "i-loader-circle" ? "icon spin" : "icon"),
      h("span", { text }),
    );
  let content = null;
  if (applying) content = badge("progress", "i-loader-circle", t("onboarding.prepare.status.enabling"));
  else if (failure) {
    content = h(
      "div",
      { class: "callout", role: "alert" },
      svg("i-circle-alert"),
      h("span", {}, h("b", { text: t("onboarding.prepare.status.failed") }), ` · ${t.text(failure.problem)}`),
      h("button", {
        type: "button",
        class: "button small retry",
        text: t("onboarding.prepare.status.retry"),
        onclick: () => changePlan(failure.plan),
      }),
    );
  } else if (needsOf(plan, setup).length === 0)
    content = badge("ok", "i-check", t("onboarding.prepare.status.enabled", { mode: modeName(plan.mode) }));
  else content = badge("", "i-circle-alert", t("onboarding.prepare.status.switched", { mode: modeName(plan.mode) }));
  box.replaceChildren(...(content ? [content] : []));
  box.hidden = content === null;
}

/** 本机模型那一行：名字、量化档、多大、从哪下；右边是下载、进度或已下载 */
function modelSection() {
  const model = transcriber(localModelOf(setup, plan.mode));
  const [base, variant] = nameParts(model.name);
  let action;
  if (model.installed) {
    action = h(
      "span",
      { class: "state-box", "data-tone": "accent" },
      svg("i-check"),
      t("onboarding.prepare.model.ready"),
    );
  } else if (model.download) {
    action = progressBadge(model.download);
  } else {
    action = h(
      "button",
      {
        type: "button",
        class: "button",
        disabled: !setup.switchable,
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          const result = await window.speakmore.downloadModel(model.id).catch((error) => ({
            ok: false,
            problem: describeError(error),
          }));
          if (!result.ok) downloadProblem = { model: model.id, problem: result.problem };
          await refresh();
        },
      },
      svg("i-download"),
      t(
        model.problem || downloadProblem?.model === model.id
          ? "onboarding.prepare.model.retry"
          : "onboarding.prepare.model.download",
      ),
    );
  }
  const problem = model.download ? null : downloadProblem?.model === model.id ? downloadProblem.problem : model.problem;
  const source = t(`onboarding.prepare.model.sources.${setup.local.source.value}`);
  return h(
    "section",
    { class: "prepare-section model-section" },
    h("h2", { class: "section-label", text: t("onboarding.prepare.sections.model") }),
    h(
      "div",
      { class: "model-row" },
      tile(model.maker ?? "local"),
      h(
        "span",
        { class: "model-text" },
        h(
          "span",
          { class: "model-name" },
          h("span", { text: base }),
          variant && h("span", { class: "tag", "data-tone": "outline", text: variant }),
        ),
        h("span", { class: "model-meta", text: `${sizeText(model.bytes)} · ${source}` }),
      ),
      h("span", { class: "model-action" }, action),
    ),
    problem &&
      h(
        "p",
        { class: "callout", role: "alert" },
        svg("i-circle-alert"),
        h("span", {}, h("b", { text: t("plaza.actionFailed") }), ` · ${t.text(problem)}`),
      ),
    !model.installed && h("p", { class: "section-hint", text: t("onboarding.prepare.model.background") }),
  );
}

/** 选哪家、填密钥那一块：同一种方式里一直是同一个节点（挪动会让输入框丢焦点），换了方式才换一块 */
function keySection() {
  const mode = plan.mode;
  if (keySlot?.mode !== mode) {
    const host = h("div", { class: "key-panel" });
    keySlot = {
      mode,
      section: h(
        "section",
        { class: "prepare-section key-section" },
        h("h2", { class: "section-label", text: t(`onboarding.prepare.sections.${mode}`) }),
        host,
        mode === "native" && h("p", { class: "section-hint", text: t("onboarding.prepare.nativeOnly") }),
      ),
      panel: createKeyPanel(host, {
        mode,
        label: t(`onboarding.prepare.sections.${mode}`),
        vendors: (current) => vendorsFor(current, mode),
        hasKey: (current, id) => hasKey(current, mode, id),
        picked: () => (mode === "native" ? plan.native : plan.polish),
        pick: (id) => changePlan(mode === "native" ? { native: id } : { polish: id }),
        // 检测时只看这一家：原生换成它的默认模型，润色只验它（第一跳用本机模型，见 app/modes.mjs 的 check）
        checkChanges: (id) => (mode === "native" ? changesOf({ ...plan, native: id }, setup) : { polish: id }),
        refresh,
        onSaved: () => {
          failure = null;
        },
      }),
    };
  }
  keySlot.panel.render(setup);
  return keySlot.section;
}

function renderPrepare() {
  $("prepare-title").replaceChildren(
    h("span", { class: "soft", text: t(`onboarding.prepare.${plan.mode}.soft`) }),
    h("span", { text: t(`onboarding.prepare.${plan.mode}.title`) }),
  );
  renderRoute();
  renderStatus();
  // 第一跳交给云端时没有要下的本机模型
  const model = plan.mode === "native" || cloudFirstHop() ? null : modelSection();
  const key = plan.mode === "private" ? null : keySection();
  const host = $("prepare-sections");
  // 密钥那一块已经在页面上就不挪（挪了输入框丢焦点），只换本机模型那一块
  if (key && key.parentNode === host) {
    const old = host.querySelector(":scope > .model-section");
    if (model && old) old.replaceWith(model);
    else if (model) host.prepend(model);
    else old?.remove();
  } else host.replaceChildren(...[model, key].filter(Boolean));
  // 都齐了就不用再说"可跳过"
  $("prepare-note").hidden = needsOf(plan, setup).length === 0;
  $("prepare-note").replaceChildren(
    svg("i-circle-alert"),
    t(plan.mode === "private" ? "onboarding.prepare.laterModel" : "onboarding.prepare.later"),
    plan.mode === "local" ? ` · ${t("onboarding.prepare.more")}` : "",
  );
}

/**
 * 体验一下、完成两步说一句现在能不能说（plan.mjs 的 readinessOf）：能说是 null；
 * 否则 { tone, icon, text }：还差什么一样一样写出来，在下的写到百分之几
 */
function readiness() {
  const state = readinessOf(setup);
  if (state === null) return null;
  const needText = (need) => {
    if (need.kind === "url") return t("home.mode.needs.url");
    if (need.kind === "key") return t("onboarding.try.needKey", { vendor: t(`providers.${need.vendor}.name`) });
    const model = transcriber(need.model);
    const name = nameParts(model.name)[0];
    if (!model.download) return t("onboarding.try.needDownload", { model: name, size: sizeText(model.bytes) });
    const percent = Math.round((model.download.received / (model.download.total || 1)) * 100);
    return t("onboarding.try.downloading", { model: name, percent });
  };
  const text = state.problem
    ? t.text(state.problem)
    : state.needs.length > 0
      ? state.needs.map(needText).join(" · ")
      : t("onboarding.try.preparing");
  const icon =
    state.tone === "progress" ? (state.needs.length > 0 ? "i-download" : "i-loader-circle") : "i-circle-alert";
  // 只是在等（下载、验证、装载）就没什么要去做的，不给按钮
  return { tone: state.tone, icon, text, fixable: state.tone === "problem" };
}

function renderTry() {
  const state = readiness();
  const box = $("try-readiness");
  box.hidden = state === null;
  if (state) {
    box.dataset.tone = state.tone;
    const fix =
      state.fixable && setup.switchable
        ? // 差的在准备那一步补：缺密钥填密钥，没下载点下载
          [
            h("button", {
              type: "button",
              class: "button small readiness-fix",
              text: t("onboarding.try.fix"),
              onclick: () => go("prepare"),
            }),
          ]
        : [];
    box.replaceChildren(
      svg(state.icon, state.icon === "i-loader-circle" ? "icon spin" : "icon"),
      h("span", { text: state.text }),
      ...fix,
    );
  }
}

/** 完成：三样各是什么样，带图标 */
function renderSummary() {
  const item = (icon, label, value, tone) =>
    h(
      "li",
      { class: "summary-item", "data-tone": tone },
      h("span", { class: "logo-tile" }, svg(icon)),
      h("span", { class: "summary-label", text: label }),
      h("span", { class: "summary-value", text: value }),
    );
  const state = readiness();
  const mode = state ? state.text : t("onboarding.prepare.status.enabled", { mode: modeName(plan.mode) });
  const mic = permissionGranted("microphone", setup.permissions.microphone);
  $("summary").replaceChildren(
    item(ICONS[plan.mode], t("onboarding.done.mode"), mode, state ? state.tone : "ok"),
    item("i-keyboard", t("onboarding.done.hotkey"), keycapOf(setup.hotkey.value), "ok"),
    item(
      "i-mic",
      t("permissions.microphone"),
      t(mic ? "permissions.granted" : "permissions.denied"),
      mic ? "ok" : "problem",
    ),
  );
}

function render() {
  if (setup === null || step === null) return;
  const states = groupStates(step);
  for (const button of document.querySelectorAll("[data-group]")) {
    button.dataset.state = states[button.dataset.group];
    button.setAttribute("aria-current", states[button.dataset.group] === "current" ? "step" : "false");
  }

  if (step === "way") renderWays();
  if (step === "prepare") renderPrepare();
  if (step === "try") renderTry();
  if (step === "done") renderSummary();

  for (const row of document.querySelectorAll("[data-permission]")) {
    const granted = permissionGranted(row.dataset.permission, setup.permissions[row.dataset.permission]);
    row.dataset.granted = String(granted === true);
    const button = row.querySelector("button");
    button.replaceChildren(
      ...(granted ? [svg("i-check"), t("onboarding.permissions.on")] : [t("onboarding.permissions.allow")]),
    );
    button.classList.toggle("primary", granted !== true);
    button.disabled = granted === true;
  }

  const keycap = keycapOf(setup.hotkey.value);
  $("big-keycap").textContent = keycap;
  fillSelect(
    $("hotkey-select"),
    setup.hotkey.choices.map((id) => [id, t(`hotkeys.${id}.name`)]),
    setup.hotkey.value,
  );
  $("try-text").placeholder = t("onboarding.try.placeholder", { keycap });

  // 底下：返回（第一步没有）、跳过引导、继续。这一步做完了"继续"是主按钮，没做完是次要的（照样能往下走）
  $("back").hidden = step === STEPS[0];
  $("skip-all").hidden = step === "done";
  const next = $("next");
  next.hidden = step === "done";
  const done = stepDone(step, { setup, said: $("try-text").value.trim() !== "" });
  next.classList.toggle("primary", done);
}

// ---------- 测麦克风 ----------

let meter = null;
let stream = null;
/** 第几次打开麦克风。每次进出这一步都加一，等麦克风回来时对不上号的就是过时了的 */
let meterRun = 0;

async function startMeter() {
  const run = ++meterRun;
  $("microphone-error").hidden = true;
  const bars = METER_BARS.map(() => document.createElement("span"));
  $("meter").replaceChildren(...bars);
  let opened;
  try {
    opened = await openMicrophone();
  } catch (error) {
    if (run !== meterRun) return;
    $("microphone-error").textContent = t("onboarding.microphone.error", { reason: describeError(error) });
    $("microphone-error").hidden = false;
    return;
  }
  // 等麦克风的这一小会儿里人可能已经走开了，甚至又回来了：那一趟有自己的一路，这一路关掉
  if (run !== meterRun) {
    for (const track of opened.getTracks()) track.stop();
    return;
  }
  stream = opened;
  meter = meterLevels(stream, (level) => {
    // 说话的音量一般只到满格的一两成，放大一点才看得出在动
    const loud = Math.min(1, level * 4);
    bars.forEach((bar, index) => {
      bar.style.height = `${0.75 + loud * METER_BARS[index] * 7}rem`;
    });
  });
}

function stopMeter() {
  meterRun += 1;
  meter?.stop();
  meter = null;
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
}

// ---------- 用户的操作 ----------

for (const button of document.querySelectorAll("[data-group]")) {
  button.addEventListener("click", () => go(firstStepOf(button.dataset.group)));
}
$("back").addEventListener("click", () => goBy(-1));
$("next").addEventListener("click", () => goBy(1));
$("skip-all").addEventListener("click", () => window.speakmore.finishOnboarding());
$("finish").addEventListener("click", () => window.speakmore.finishOnboarding());

for (const row of document.querySelectorAll("[data-permission]")) {
  row
    .querySelector("button")
    .addEventListener("click", () => window.speakmore.openPrivacySettings(row.dataset.permission));
}

$("microphone-yes").addEventListener("click", () => goBy(1));
$("microphone-no").addEventListener("click", () => {
  $("microphone-help").hidden = false;
});
$("microphone-settings").addEventListener("click", () => window.speakmore.openPrivacySettings("microphone"));

$("hotkey-yes").addEventListener("click", () => goBy(1));
$("hotkey-no").addEventListener("click", () => {
  $("hotkey-choice").hidden = false;
  $("hotkey-select").focus();
});
$("hotkey-select").addEventListener("change", async (event) => {
  $("hotkey-note").hidden = true;
  try {
    const result = await window.speakmore.setHotkey(event.target.value);
    $("hotkey-note").textContent = result.note ? t.text(result.note) : t("onboarding.hotkey.switched");
  } catch (error) {
    $("hotkey-note").textContent = t("onboarding.hotkey.failed", { reason: describeError(error) });
  }
  $("hotkey-note").hidden = false;
  await refresh();
});

// 说完的话贴进笔记里了："继续"变成主按钮
$("try-text").addEventListener("input", render);

// ---------- 主进程来的 ----------

window.speakmore.onSetupChanged(refresh);
window.speakmore.onOnboardingHotkey(({ down }) => {
  if (down) $("big-keycap").dataset.pressed = "";
  else delete $("big-keycap").dataset.pressed;
});

await refresh();
go(startStep(setup));
