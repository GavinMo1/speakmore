import { writeFileSync } from "node:fs";

// 端到端测试时由主进程加载（设了 SPEAKMORE_E2E_OUT 才会）。它代替人做两件事：
// 模拟"按一下热键、说几秒、再按一下"，以及在该贴字的时候只记下文字、不真的去贴。
// 麦克风由 Chromium 的假设备提供（scripts/dev/e2e.mjs 传的启动参数），整条链路其余部分都是真的。
// 走 local 模式时，先等本地模型下载、装好再按热键（数据目录是新的，模型真的要从下载源下一遍），记下各花了多久。

const OUT_PATH = process.env.SPEAKMORE_E2E_OUT;
const RECORD_MS = Number(process.env.SPEAKMORE_E2E_RECORD_MS ?? 7_500);
// 按需加载时第一次要冷启动，给足时间
const GIVE_UP_MS = RECORD_MS + 120_000;
// 听写几遍（SPEAKMORE_E2E_ROUNDS）。本机模型按需加载时，两遍之间等它空闲释放，下一遍就验了重新装载
const ROUNDS = Number(process.env.SPEAKMORE_E2E_ROUNDS ?? 1);
// 空闲释放时间最长 30 分钟，再多等一会儿
const RELEASE_GIVE_UP_MS = 31 * 60_000;

const pasted = [];
let finish = null;

export const fakeHelper = {
  async paste(text) {
    pasted.push(text);
    return { ok: true, reason: null };
  },
  // 不听真键盘，也不截真的取消键和鼠标点击
  bind() {},
  capture() {},
  release() {},
  record() {},
  probe: async () => ({ conflict: false }),
  info: async () => ({}),
  stop() {},
};

/** 主进程在一次听写有了结局（成功或失败）时调用 */
export function onFinished(outcome) {
  finish?.(outcome);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 本地模型装好之前一直等。还没下载的替用户点一下下载（App 不会自己下），每过 10% 说一声。不走 local 模式时直接返回
 * @param {() => object | null} localModel 服务报的本地模型状态（app/service.mjs 的 localModel）
 * @param {(id: string) => Promise<{ ok: boolean, problem?: object }>} downloadModel 模型库的下载（models/library.mjs）
 * @returns {Promise<{ downloadMs: number, loadMs: number, backend: string } | { failed: string } | null>}
 */
async function waitForLocalModel(localModel, downloadModel) {
  if (!localModel() || localModel().state === "off") return null;
  const startedAt = performance.now();
  let downloadedAt = null;
  let reported = -1;
  let asked = false;
  for (;;) {
    const local = localModel();
    if (local.state === "failed") return { failed: JSON.stringify(local.problem) };
    if (local.state === "missing" && !local.total && !asked) {
      asked = true;
      const started = await downloadModel(local.model);
      if (!started.ok) return { failed: JSON.stringify(started.problem) };
    } else if (local.state === "missing" && local.total) {
      const percent = Math.floor((local.received / local.total) * 10) * 10;
      if (percent !== reported) console.log(`本地模型下载中 ${percent}%`);
      reported = percent;
    } else if (local.state !== "missing" && downloadedAt === null) downloadedAt = performance.now();
    if (local.state === "idle") return null;
    if (local.state === "ready") {
      return {
        downloadMs: Math.round(downloadedAt - startedAt),
        loadMs: Math.round(performance.now() - downloadedAt),
        backend: local.backend,
      };
    }
    await sleep(200);
  }
}

/** 按需加载的本机模型空闲释放之前一直等，返回等了多久；等不到是 null */
async function waitForRelease(localModel) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < RELEASE_GIVE_UP_MS) {
    if (localModel()?.state === "idle") return Math.round(performance.now() - startedAt);
    await sleep(500);
  }
  return null;
}

/**
 * @param {object} options
 * @param {() => string} options.localModelMemory 本机模型常驻还是按需加载（main.mjs 里正在用的那个）
 */
export async function run({ bar, history, localModel, localModelMemory, downloadModel, quit }) {
  const rounds = [];
  const done = (result, code) => {
    writeFileSync(OUT_PATH, JSON.stringify({ ...result, rounds, pasted, history: history.list() }, null, 2));
    quit(code);
  };
  const local = await waitForLocalModel(localModel, downloadModel);
  if (local?.failed) return done({ failed: `本地模型没装上：${local.failed}` }, 1);

  // 走到这里时页面可能已经加载完了，那样就等不到 did-finish-load
  if (bar.webContents.isLoading()) {
    await new Promise((resolve) => bar.webContents.once("did-finish-load", resolve));
  }
  // 和主进程认出小帮手报的绑定事件之后交给悬浮条的一样（main.mjs 的 onBindingEvent）
  const press = async () => {
    bar.webContents.send("input", { event: "binding", action: "dictate", down: true });
    await sleep(120);
    bar.webContents.send("input", { event: "binding", action: "dictate", down: false });
  };
  await sleep(500);

  for (let round = 1; round <= ROUNDS; round++) {
    // 主进程收到成品就报了结局，悬浮条要等交付的回话才回到空闲：这时按下会被当成整理中按的，不算数
    if (round > 1) await sleep(1_000);
    if (round > 1 && localModelMemory() === "on-demand") {
      const releasedMs = await waitForRelease(localModel);
      if (releasedMs === null) return done({ failed: `第 ${round - 1} 遍之后本机模型一直没释放` }, 1);
      console.log(`第 ${round - 1} 遍之后 ${(releasedMs / 1000).toFixed(1)} 秒，本机模型释放了`);
    }
    const giveUp = setTimeout(
      () => done({ failed: `第 ${round} 遍等了 ${GIVE_UP_MS / 1000} 秒没有结局` }, 1),
      GIVE_UP_MS,
    );
    const outcome = new Promise((resolve) => {
      finish = resolve;
    });
    await press();
    await sleep(RECORD_MS);
    await press();
    const stoppedAt = performance.now();
    const result = await outcome;
    clearTimeout(giveUp);
    // 松开到出字：按需加载时第一遍里含冷启动
    rounds.push({ ...result, ms: Math.round(performance.now() - stoppedAt) });
    if (result.failed) return done({ failed: `第 ${round} 遍：${result.failed}` }, 1);
  }
  done({ ...rounds.at(-1), ...(local ? { localModel: local } : {}) }, 0);
}
