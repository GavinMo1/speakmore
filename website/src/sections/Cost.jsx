import { useEffect, useRef, useState } from "react";
import { Heading, Section } from "../components/Section.jsx";
import { useI18n } from "../i18n/index.jsx";
import { useReducedMotion } from "../lib/usePageMotion.js";

// 每一位数字是一条 0–9 走两遍的竖条，最后停在第二遍的那个数上：0 也会滚一圈，几位一起转才像计数器
const STRIP = [..."01234567890123456789"];

/** 花多少钱：单次、每月、免费额度内三个数排一行，滚到这里时数字像计数器一样转到位。数字的出处在 README，页面上不写 */
export function Cost() {
  const { m } = useI18n();
  const roll = useRollOnce();
  const facts = [
    { ...m.cost.once, id: "once" },
    { ...m.cost.month, id: "month", highlight: true },
    { ...m.cost.free, id: "free" },
  ];
  return (
    <Section id="cost" tone="surface" labelledBy="cost-title">
      <Heading id="cost-title" title={m.cost.title} lead={m.cost.lead} />

      <dl
        ref={roll.ref}
        data-roll={roll.stage}
        className="reveal mx-auto mt-[clamp(3.5rem,8vw,6rem)] grid max-w-5xl gap-12 text-center lg:grid-cols-[1fr_1.45fr_1fr] lg:gap-6"
      >
        {facts.map((fact) => (
          // 数在上、说明在下；dl 里 dt 得写在前面，所以倒过来排
          <div key={fact.id} className="flex flex-col-reverse items-center gap-2">
            <dt className={fact.highlight ? "font-medium text-ink" : "text-ink-2"}>{fact.label}</dt>
            <dd
              className={`font-rounded text-[clamp(2.5rem,5vw,3.75rem)] leading-[1.25] font-semibold tracking-tight whitespace-nowrap tabular-nums ${
                fact.highlight ? "text-cinnabar" : "text-ink"
              }`}
            >
              <Rolling value={fact.value} />
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/**
 * 数字什么时候转：一开始停在结果上（没有 IntersectionObserver、减弱动态效果、或一进来就已经在屏幕上时一直这样）；
 * 还在屏幕下面时先归零（ready），整行露出来时转到结果（roll），只转一次。
 * 不跟着滚动一格一格走：访客停在半路时，数字会卡在半截，像坏了
 */
function useRollOnce() {
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
        setStage("roll");
        observer.disconnect();
      },
      // 整行露出来、离底边还有一点时才转，访客正好看着它转
      { threshold: 1, rootMargin: "0px 0px -12% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [reduced]);
  return { ref, stage };
}

/** 一个数：读屏读整串；画面上每位数字是一条会滚的竖条（styles.css 的 .roll），别的字符原样 */
function Rolling({ value }) {
  return (
    <>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="inline-flex">
        {[...value].map((char, place) =>
          /\d/.test(char) ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: 字符的位置是固定的
            <span key={place} className="roll" style={{ "--d": 10 + Number(char), "--p": place }}>
              <span>
                {STRIP.map((digit, row) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 竖条是固定的两遍 0–9
                  <span key={row}>{digit}</span>
                ))}
              </span>
            </span>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: 字符的位置是固定的
            <span key={place}>{char}</span>
          ),
        )}
      </span>
    </>
  );
}
