import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

const PASTE_TIMEOUT_MS = 3_000;
/** 探测冲突、问系统信息等多久：只是查一下，回不来就当没查到，不挡着录键 */
const QUERY_TIMEOUT_MS = 1_500;

/**
 * 小帮手的源码、编好的可执行文件、指纹文件在哪。App 启动时要用，所以放在这一层：
 * Mac 的 .app 里不带 src/cli（scripts/build/stage-app.mjs 的 MAC_APP_IGNORE），从那里引就打不开。
 * 怎么编、什么时候要重编在 src/cli/native-helper.mjs
 * @param {string} packageDir
 * @param {NodeJS.Platform} [platform] 给哪个系统的
 */
export function helperPaths(packageDir, platform = process.platform) {
  const windows = platform === "win32";
  const binary = join(packageDir, "build", windows ? "key-helper.exe" : "key-helper");
  return {
    // 两个系统的都是一个目录：Windows 的是 Go 模块，macOS 的是几个 Swift 文件
    source: join(packageDir, "native", windows ? "windows" : "mac"),
    binary,
    /** 可执行文件是从哪份源码编出来的：那份源码的 SHA-256 */
    stamp: `${binary}.source-sha256`,
  };
}

/**
 * 启动原生小帮手（native/mac/、native/windows/）并和它对话。两边用"一行一个 JSON"通信。
 * @param {string} command 可执行文件
 * @param {object} options
 * @param {string[]} [options.args]
 * @param {(event: object) => void} options.onEvent 收到 ready / bound / binding / interrupted / click / recording 等，
 *   以及小帮手不在了（退出或根本没起来）时的 exit，只报一次。pasted、probed、info 是对某条命令的回执，交给那条命令的调用方
 * @param {{ warn: Function, error: Function }} options.log
 */
export function startHelper(command, { args = [], onEvent, log }) {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
  /** 发出去还没回的粘贴请求：id → { resolve, reject, timer } */
  const pending = new Map();
  let nextId = 1;
  /** 发出去还没回的探测：id → 回执来了交给谁 */
  const probes = new Map();
  let nextProbe = 1;
  /** 问系统信息的，按发出的先后排着：回执不带 id，一问一答 */
  const infos = [];
  let exited = false;

  const rejectAll = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };

  createInterface({ input: child.stdout }).on("line", (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      log.warn("helper_bad_line", { line: line.slice(0, 200) });
      return;
    }
    if (event.event === "pasted") {
      const request = pending.get(event.id);
      if (!request) return;
      pending.delete(event.id);
      clearTimeout(request.timer);
      request.resolve({ ok: event.ok, reason: event.reason ?? null });
    } else if (event.event === "probed") {
      probes.get(event.id)?.(event);
    } else if (event.event === "info") {
      infos.shift()?.(event);
    } else if (event.event === "error") {
      log.error("helper_error", { message: event.message });
    } else {
      onEvent(event);
    }
  });
  createInterface({ input: child.stderr }).on("line", (line) => log.warn("helper_stderr", { line }));

  /** 它不在了：等着的粘贴全部失败，并往上报一次。启动不起来和中途退出都走这里 */
  const gone = (reason, code = null, signal = null) => {
    if (exited) return;
    exited = true;
    rejectAll(reason);
    // 探测、系统信息的等着的照常有个结果：按"没查到"算
    for (const answer of probes.values()) answer(null);
    for (const answer of infos.splice(0)) answer(null);
    onEvent({ event: "exit", code, signal });
  };

  child.on("error", (error) => {
    // 可执行文件不存在或没有执行权限时只有这个事件，不会再有 exit
    log.error("helper_spawn_failed", { command, error: String(error) });
    gone(error);
  });
  child.on("exit", (code, signal) => gone(new Error("原生小帮手退出了"), code, signal));

  /** 说过停（stdin 已关）：之后再来的命令不写。退出时窗口关了还会收尾一次录键，往关掉的流里写会抛错 */
  let stopping = false;
  /** 写一行命令。小帮手不在了、正在退就什么也不做：那时热键本身也不灵，exit 已经往上报过了 */
  const send = (command) => {
    if (!exited && !stopping) child.stdin.write(`${JSON.stringify(command)}\n`);
  };

  return {
    /**
     * 换一份绑定表（src/hotkeys/bindings.mjs 的 bindingTable），整表替换。小帮手回 bound，说哪些装不上、为什么
     * @param {Array<{ id: string, mods: number[], key?: number, when: string }>} bindings
     */
    bind(bindings) {
      send({ cmd: "bind", bindings });
    },
    /**
     * 把文字贴进当前输入框。
     * @returns {Promise<{ ok: boolean, reason: string | null }>} ok 为 false 时文字留在剪贴板里
     */
    paste(text) {
      if (exited || stopping) return Promise.reject(new Error("原生小帮手没有在运行"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("粘贴没有在限时内完成"));
        }, PASTE_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ cmd: "paste", id, text })}\n`);
      });
    },
    /**
     * 听写进行中：只在说话时生效的绑定（取消）开始算数，这几块里的鼠标点击截下来，都不让别的应用收到。
     * 截到了会报那个绑定的 binding、点击的 click
     * @param {{ id: string, x: number, y: number, width: number, height: number }[]} regions 屏幕坐标
     */
    capture(regions) {
      send({ cmd: "capture", regions });
    },
    /** 不截了 */
    release() {
      send({ cmd: "release" });
    },
    /**
     * 进出录键模式（docs/hotkey-research.md 5.6）。录键时匹配暂停，小帮手每当按住的键变了就报一次 recording，
     * 离开时（这里让停的、它 30 秒到点自己停的）报 recording on:false
     */
    record(on) {
      send({ cmd: "record", on });
    },
    /**
     * 这个组合是不是已经被系统（Mac 的系统快捷键）或别的程序（Windows 上 RegisterHotKey 登记过的）占了。
     * 回执不来（小帮手不在、超时）时按不冲突算，带 timedOut
     * @param {{ mods: number[], key: number }} chord 原生码，写法同绑定表
     * @returns {Promise<{ conflict: boolean, source?: string, timedOut?: true }>}
     */
    probe(chord, { timeoutMs = QUERY_TIMEOUT_MS } = {}) {
      if (exited || stopping) return Promise.resolve({ conflict: false, timedOut: true });
      const id = nextProbe++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => answer(null), timeoutMs);
        const answer = (event) => {
          clearTimeout(timer);
          probes.delete(id);
          if (event === null) resolve({ conflict: false, timedOut: true });
          else
            resolve({
              conflict: event.conflict === true,
              ...(event.conflict && event.source ? { source: event.source } : {}),
            });
        };
        probes.set(id, answer);
        send({ cmd: "probe", id, mods: chord.mods, key: chord.key });
      });
    },
    /**
     * 系统设置里和热键相关的值（Mac：fnUsage 是"按下地球仪键时"那一项）。回执不来时是空的
     * @returns {Promise<{ fnUsage?: number }>}
     */
    info({ timeoutMs = QUERY_TIMEOUT_MS } = {}) {
      if (exited || stopping) return Promise.resolve({});
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const index = infos.indexOf(answer);
          if (index !== -1) infos.splice(index, 1);
          resolve({});
        }, timeoutMs);
        const answer = (event) => {
          clearTimeout(timer);
          resolve(Number.isInteger(event?.fnUsage) ? { fnUsage: event.fnUsage } : {});
        };
        infos.push(answer);
        send({ cmd: "info" });
      });
    },
    /** 关掉标准输入，小帮手会自己退出 */
    stop() {
      stopping = true;
      child.stdin.end();
    },
  };
}
