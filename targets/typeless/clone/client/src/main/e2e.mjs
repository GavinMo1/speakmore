import { writeFileSync } from "node:fs";

// 端到端测试时由主进程加载（设了 CLONE_E2E_OUT 才会）。它代替人做两件事：
// 模拟"按一下热键、说几秒、再按一下"，以及在该贴字的时候只记下文字、不真的去贴。
// 麦克风由 Chromium 的假设备提供（scripts/e2e.mjs 传的启动参数），整条链路其余部分都是真的。

const OUT_PATH = process.env.CLONE_E2E_OUT;
const RECORD_MS = Number(process.env.CLONE_E2E_RECORD_MS ?? 7_500);
const GIVE_UP_MS = RECORD_MS + 40_000;

const pasted = [];
let finish = null;

export const fakeHelper = {
  async paste(text) {
    pasted.push(text);
    return { ok: true, reason: null };
  },
  stop() {},
};

/** 主进程在一次听写有了结局（成功或失败）时调用 */
export function onFinished(outcome) {
  finish?.(outcome);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run({ bar, history, quit }) {
  const done = (result, code) => {
    writeFileSync(OUT_PATH, JSON.stringify({ ...result, pasted, history: history.list() }, null, 2));
    quit(code);
  };
  const giveUp = setTimeout(() => done({ failed: `等了 ${GIVE_UP_MS / 1000} 秒没有结局` }, 1), GIVE_UP_MS);
  const outcome = new Promise((resolve) => {
    finish = resolve;
  });

  // 走到这里时页面可能已经加载完了，那样就等不到 did-finish-load
  if (bar.webContents.isLoading()) {
    await new Promise((resolve) => bar.webContents.once("did-finish-load", resolve));
  }
  const press = async () => {
    bar.webContents.send("hotkey", { event: "hotkey", down: true });
    await sleep(120);
    bar.webContents.send("hotkey", { event: "hotkey", down: false });
  };
  await sleep(500);
  await press();
  await sleep(RECORD_MS);
  await press();

  const result = await outcome;
  clearTimeout(giveUp);
  done(result, result.failed ? 1 : 0);
}
