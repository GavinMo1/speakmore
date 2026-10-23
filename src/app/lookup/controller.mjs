import { msg, problemOf } from "../../i18n/index.mjs";
import { findLanguage, LANGUAGES } from "../../languages.mjs";

// 划词翻译的流程：按下划词的键 → 取选区（小帮手）→ 在选区下方弹卡片（先是翻译中）→ 译好换上译文、记进历史。
// 卡片上能复制、换语言（只管这一次）、固定。esc、关闭按钮、点别处收起。
// 他定的：不贴字、只弹卡片；进历史，首页的口述统计不算它，花费照记（记账在 server/lookup/translator.mjs）。
// 也不替换原文（10-23 砍掉了"替换选中文字"）：选区多在网页、App 里，不一定能改，往原处贴会出各种问题，只给复制。
// 这里只管流程和状态，不碰 Electron：卡片窗口、小帮手、剪贴板、历史都由主进程按下面的接口交进来，测试时换成假的。
//
// 交给卡片画的样子（view）：
//   { id, phase: loading | done | error, language, languages, text, problem, action: keys | retry | null, pinned }
//   id 每次按键换一个（卡片据此收起上一次展开的语言选单）；text 是译文；problem 是出错时的那句话（msg 或原话）；
//   action 是出错时那一个按钮：缺 key、key 不对、自定义服务没配好时去配置密钥，别的重试

/** 一次最多译多少字：选中一整页没有意义，模型也要等很久 */
export const MAX_LOOKUP_CHARS = 4000;

/** 取不到字时在悬浮条上说什么，按小帮手回的原因（app/helper.mjs 的 selection） */
const NO_TEXT = {
  none: "lookup.noSelection",
  not_trusted: "lookup.noAccessibility",
  elevated: "lookup.elevated",
};

/** 出错时给哪个按钮：缺东西、key 不对的去配置密钥，别的重试 */
const KEY_PROBLEMS = new Set(["missing", "unreadable", "setup", "key"]);

const LANGUAGE_IDS = Object.freeze(LANGUAGES.map(({ id }) => id));

/** 选中的字：换行统一成 \n（Windows 记事本里是 \r，有的应用是 \r\n），首尾空白去掉 */
const normalize = (text) => text.replace(/\r\n?/g, "\n").trim();

/**
 * @param {object} deps
 * @param {() => Promise<{ text: string, rect: object | null, via?: string | null, reason?: string | null, ms?: number | null }>} deps.selection
 *   取选区（app/helper.mjs 的 selection）；rect 是屏幕坐标、原样交给卡片
 * @param {{ current(): { to: string }, translate(text: string, o: { language: string, lookupId: string, signal: AbortSignal }): Promise<{ text: string }> }} deps.engine
 *   app/lookup/engine.mjs
 * @param {{ show(view: object, anchor: { rect: object | null }): void, update(view: object): void, hide(): void }} deps.card 卡片窗口
 * @param {(text: string) => void} deps.copy 放进剪贴板
 * @param {(message: object) => void} deps.notify 在悬浮条上说一句
 * @param {(entry: object) => void} deps.record 记进历史（storage/history.mjs 的 add 的样子）
 * @param {() => boolean} deps.busy 正在说话（悬浮条截着键）：这时不理划词
 * @param {() => void} deps.openKeys 打开引擎页划词那一段，配置密钥
 * @param {() => string} deps.newId 每次翻译一个 id：历史、记账按它对上
 * @param {() => Date} [deps.now]
 * @param {{ info: Function, warn: Function, error: Function }} deps.log
 */
export function createLookup({
  selection,
  engine,
  card,
  copy,
  notify,
  record,
  busy,
  openKeys,
  newId,
  now = () => new Date(),
  log,
}) {
  /**
   * 开着的那一张：{ source, language, produced, pinned, phase, text, problem, action, lookupId, abort }；没开是 null。
   * language 是要译成的（设置里的、卡片上换的），produced 是实际译成的
   */
  let session = null;
  /** 第几次按键：取选区要等一会儿，等回来时又按过了就作废 */
  let presses = 0;

  const view = (current) => ({
    id: current.pressId,
    phase: current.phase,
    // 译好了写实际译成的那种：原文已经是目标语言时内核改译成了另一种（server/lookup/translator.mjs）
    language: current.phase === "done" ? current.produced : current.language,
    languages: LANGUAGE_IDS,
    text: current.text,
    problem: current.problem,
    action: current.action,
    pinned: current.pinned,
  });

  function close(reason) {
    if (!session) return;
    session.abort?.abort();
    log.info("lookup_closed", { reason, phase: session.phase, pinned: session.pinned });
    session = null;
    card.hide();
  }

  /** 按这一次的语言译（再）一遍：每一遍一个新 id，历史里各是一条 */
  async function translate(current) {
    current.abort?.abort();
    const abort = new AbortController();
    const lookupId = newId();
    Object.assign(current, { abort, lookupId, phase: "loading", text: "", problem: null, action: null });
    card.update(view(current));
    const startedAt = performance.now();
    const language = current.language;
    try {
      const result = await engine.translate(current.source, { language, lookupId, signal: abort.signal });
      if (session !== current || abort.signal.aborted) return;
      const { text } = result;
      const produced = result.language ?? language;
      if (text === "") throw Object.assign(new Error("模型回了空的译文"), { problem: msg("lookup.empty") });
      Object.assign(current, { phase: "done", text, produced });
      card.update(view(current));
      // 只记长度：选中的字、译文都是用户的内容
      log.info("lookup_translated", {
        lookup_id: lookupId,
        language,
        produced,
        source_length: current.source.length,
        text_length: text.length,
        ms: Math.round(performance.now() - startedAt),
      });
      remember(current, { lookupId, text, produced });
    } catch (error) {
      if (session !== current || abort.signal.aborted) return;
      const kind = error?.kind ?? "other";
      log.warn("lookup_failed", {
        lookup_id: lookupId,
        language,
        kind,
        ms: Math.round(performance.now() - startedAt),
        error: String(error?.message ?? error).slice(0, 300),
      });
      Object.assign(current, {
        phase: "error",
        problem: problemOf(error),
        action: KEY_PROBLEMS.has(kind) ? "keys" : "retry",
      });
      card.update(view(current));
    }
  }

  /**
   * 记进历史。写不进去（库忙、磁盘满）只记一条错误日志：译文已经画在卡片上了，不能因此翻成"出错、重试"，
   * 重试还要再花一次钱
   */
  function remember(current, { lookupId, text, produced }) {
    try {
      record({
        id: lookupId,
        kind: "lookup",
        status: "completed",
        refinedText: text,
        sourceText: current.source,
        outputLanguage: produced,
        error: null,
        duration: 0,
        audioFile: null,
        createdAt: now().toISOString(),
      });
    } catch (error) {
      log.error("lookup_record_failed", { lookup_id: lookupId, error: String(error?.message ?? error).slice(0, 300) });
    }
  }

  const ACTIONS = {
    close: () => close("button"),
    copy: (current) => {
      if (current.phase !== "done") return;
      copy(current.text);
      log.info("lookup_copied", { lookup_id: current.lookupId });
    },
    pin: (current) => {
      current.pinned = !current.pinned;
      card.update(view(current));
    },
    retry: (current) => {
      if (current.phase === "error") translate(current);
    },
    keys: () => {
      close("keys");
      openKeys();
    },
  };

  return {
    /** 卡片开着没有 */
    get open() {
      return session !== null;
    },

    /** 按下了划词的键 */
    async press() {
      if (busy()) {
        log.info("lookup_ignored", { reason: "busy" });
        return;
      }
      close("pressed_again");
      const press = ++presses;
      const picked = await selection();
      // 只记长度和方式，不记选中的字
      log.info("lookup_selection", {
        via: picked.via ?? null,
        ms: picked.ms ?? null,
        length: picked.text.length,
        rect: picked.rect !== null,
        reason: picked.reason ?? null,
      });
      if (press !== presses) return;
      // 等选区的这段时间里开始说话了（模拟复制最长要等一两秒）：卡片不出，不抢悬浮条的截取
      if (busy()) {
        log.info("lookup_ignored", { reason: "busy" });
        return;
      }
      const source = normalize(picked.text);
      if (source === "") {
        notify(msg(NO_TEXT[picked.reason] ?? (picked.text === "" ? "lookup.selectionFailed" : "lookup.noSelection")));
        return;
      }
      if (source.length > MAX_LOOKUP_CHARS) {
        notify(msg("lookup.tooLong", { max: MAX_LOOKUP_CHARS }));
        return;
      }
      const current = {
        pressId: press,
        source,
        language: engine.current().to,
        produced: null,
        pinned: false,
        phase: "loading",
        text: "",
        problem: null,
        action: null,
        lookupId: null,
        abort: null,
      };
      session = current;
      card.show(view(current), { rect: picked.rect });
      translate(current);
    },

    /**
     * 卡片上点了什么：close、copy、pin、retry、keys，或者 pick:<语言 id>（换语言，只管这一次）
     * @param {string} action
     */
    act(action) {
      const current = session;
      if (!current) return;
      log.info("lookup_action", { action });
      if (action.startsWith("pick:")) {
        const language = findLanguage(action.slice("pick:".length));
        if (language === null || language.id === current.language) return;
        current.language = language.id;
        translate(current);
        return;
      }
      ACTIONS[action]?.(current);
    },

    /** 点了卡片以外的地方：收起，固定了的不收 */
    outside() {
      if (session && !session.pinned) close("outside");
    },

    /** esc */
    cancel() {
      close("esc");
    },

    /** 别的原因要收起（开始说话了、小帮手退出了） */
    close,
  };
}
