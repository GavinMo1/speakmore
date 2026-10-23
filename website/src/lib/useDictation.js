import { useEffect, useRef, useState } from "react";

/** 一轮演示的节奏（毫秒）：边说边出字 → 整理 → 打勾 → 删掉的淡出、成品出来 → 停一会儿 */
export const DICTATION_MS = { type: 1800, finish: 700, done: 350, hold: 2800 };

/**
 * 口述演示放一轮：phase 依次是 talk（边说边出字，progress 从 0 走到 1）、finishing（整理中）、done（打勾）、
 * written（成品出来），停够了调 onEnd（换下一个例子，或者重放）。
 * 不在播（不在屏幕上、减弱动态效果）时直接停在成品上。round 变了就从头再放
 * @param {boolean} playing
 * @param {unknown} round 换例子、重放时变一下
 * @param {() => void} onEnd
 * @param {typeof DICTATION_MS} [ms]
 */
export function useDictation(playing, round, onEnd, ms = DICTATION_MS) {
  const [phase, setPhase] = useState("talk");
  const [progress, setProgress] = useState(0);
  // 放完了做什么由调用的人每次渲染给，不必跟着它重放
  const end = useRef(onEnd);
  end.current = onEnd;

  // biome-ignore lint/correctness/useExhaustiveDependencies: round 不在里面用，但它一变就要重放
  useEffect(() => {
    if (!playing) {
      setPhase("written");
      setProgress(1);
      return undefined;
    }
    setPhase("talk");
    setProgress(0);
    let frame = 0;
    const started = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - started) / ms.type);
      setProgress(p);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const timers = [
      setTimeout(() => setPhase("finishing"), ms.type),
      setTimeout(() => setPhase("done"), ms.type + ms.finish),
      setTimeout(() => setPhase("written"), ms.type + ms.finish + ms.done),
      setTimeout(() => end.current(), ms.type + ms.finish + ms.done + ms.hold),
    ];
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    };
  }, [playing, round, ms]);

  /** 悬浮条这时候的样子 */
  const bar = phase === "talk" ? "recording" : phase === "finishing" ? "finishing" : "done";
  return { phase, progress, bar, written: phase === "written" };
}
