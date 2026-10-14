import { TimeoutError } from "../../control.mjs";
import {
  currentSettings,
  noPositionals,
  PACKAGED_NOTE,
  PACKAGED_RELAUNCH,
  parse,
  permissionMissing,
  readStats,
  showStatus,
} from "../common.mjs";
import { hasKeyAlready, keyPrompter, needsNewKey, submitKey } from "./key.mjs";

// 起停和看状态：speakmore（start）、stop、restart、status。

export async function start(args, io) {
  noPositionals(parse(args).positionals, "speakmore start");
  const settings = currentSettings(io);
  const nextKey = keyPrompter(io);

  let started = await io.daemon.status();
  /** 问到的第一把 key。undefined：还没问过；null：问了，没填 */
  let firstKey;
  if (started === null) {
    // 哪儿都没有 key 的话先问、再启动：启动要等一阵（第一次还要下载、点授权框），那段时间终端是照常回显的，
    // 到那时才问的话，提前粘贴的人会看到 key 显示在屏幕上
    if (io.interactive && !hasKeyAlready(io)) firstKey = await nextKey();
    io.out("正在启动 SpeakMore…");
    started = await io.daemon.start({ onProgress: io.out });
  }
  if (firstKey === undefined && io.interactive && needsNewKey(started.key)) firstKey = await nextKey();
  // 不填或取消都不纠缠，面板里会说还差它
  for (let value = firstKey ?? null; value !== null; value = await nextKey()) {
    if (await submitKey(io, value)) break;
  }
  // 重新查一遍系统权限：用户可能刚去系统设置里改过
  const status = (await io.daemon.status({ recheck: true })) ?? started;

  const openSettings = io.interactive && !status.starting && permissionMissing(status);
  if (openSettings) await io.daemon.request("show-settings");
  io.out("");
  showStatus(io, status, settings);
  if (openSettings) io.out("已经打开设置窗口，照着把缺的权限补上。补完运行 speakmore status 再看一眼。");
  return 0;
}

const STOPPED = {
  "not-running": "SpeakMore 本来就没有在运行。",
  quit: "SpeakMore 已经停掉。",
  killed: "SpeakMore 卡住了没有回应，已经强行结束。",
};

export async function stop(args, io) {
  noPositionals(parse(args).positionals, "speakmore stop");
  io.out(STOPPED[await io.daemon.stop()]);
  return 0;
}

export async function restart(args, io) {
  noPositionals(parse(args).positionals, "speakmore restart");
  currentSettings(io);
  let current = null;
  try {
    current = await io.daemon.status();
  } catch (error) {
    // 卡住不答话：正是要重启的时候，下面的 stop 会把它强行结束
    if (!(error instanceof TimeoutError)) throw error;
  }
  if (current?.packaged) {
    io.err(`${PACKAGED_NOTE}从命令行重启会把它换成终端启动的那一个，权限和 key 都是另一套。`);
    io.err(`要重启它：${PACKAGED_RELAUNCH}。`);
    return 1;
  }
  await io.daemon.stop();
  return start([], io);
}

export async function status(args, io) {
  const { values, positionals } = parse(args, { json: { type: "boolean", default: false } });
  noPositionals(positionals, "speakmore status [--json]");
  const settings = currentSettings(io);
  const current = await io.daemon.status({ recheck: true });
  if (values.json) {
    io.out(JSON.stringify({ running: current !== null, status: current, settings, stats: readStats(io) }));
  } else {
    showStatus(io, current, settings);
  }
  return current?.summary.ready ? 0 : 1;
}
