import { useEffect, useRef, useState } from "react";

/** 访客开了"减弱动态效果"没有。开着时演示不自己播，停在结果上 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** 这块在不在屏幕上：不在时演示停下，不白白跑定时器 */
export function useOnScreen(ref) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || !("IntersectionObserver" in window)) {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}

/**
 * 一块东西进场的动画什么时候放：一开始就是放完的样子（rest：没有 IntersectionObserver、减弱动态效果、
 * 或一进来就已经在屏幕上时一直这样，内容不靠动画才看得见）；还在屏幕下面时先退回起点（ready），
 * 滚到时放一次（play）。成本、性能的数字（Rolling 和 styles.css 的 .roll）、识别方式的路线图都用它。
 * 不跟着滚动一格一格走：访客停在半路时，会卡在半截，像坏了。
 * bottom：顶边进到离屏幕下沿多远才放（rootMargin 的下边），默认四分之一屏
 * @returns {{ ref: import("react").RefObject<HTMLElement>, stage: "rest" | "ready" | "play" }}
 */
export function useEnterOnce(bottom = "-25%") {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [stage, setStage] = useState("rest");
  useEffect(() => {
    const element = ref.current;
    if (reduced || !element || !("IntersectionObserver" in window)) return undefined;
    if (element.getBoundingClientRect().top < window.innerHeight) return undefined;
    setStage("ready");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setStage("play");
        observer.disconnect();
      },
      // 这一块的顶边进到屏幕下四分之一以内才转：数字在块的上面，访客正好看着它转。
      // 不等整块露出来：块比屏幕还高时永远等不到
      { threshold: 0, rootMargin: `0px 0px ${bottom} 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [reduced, bottom]);
  return { ref, stage };
}
