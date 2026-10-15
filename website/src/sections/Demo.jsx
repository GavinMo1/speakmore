import { useEffect, useRef, useState } from "react";
import { Bar } from "../components/Bar.jsx";
import { Heading, Section } from "../components/Section.jsx";
import { useI18n } from "../i18n/index.jsx";
import { cutMarks } from "../lib/text.js";
import { useOnScreen, useReducedMotion } from "../lib/usePageMotion.js";

// 一轮演示的节奏（毫秒）：边说边出字 → 整理 → 打勾 → 删掉的淡出、成品出来 → 停一会儿换下一个
const TYPE_MS = 3200;
const FINISH_MS = 1300;
const DONE_MS = 600;
const HOLD_MS = 4200;

/**
 * 左边是口述（边说边出现），右边是写出来的成品。口头禅、重复、改口在口述里一段接一段淡出、虚掉，不划线。
 * 例子都是 App 的真实输出（合成语音口述给 Gemini 3.6 Flash）
 */
export function Demo() {
  const { m } = useI18n();
  const examples = m.demo.examples;
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState("talk");
  const [progress, setProgress] = useState(0);
  const root = useRef(null);
  const onScreen = useOnScreen(root);
  const reduced = useReducedMotion();
  const playing = onScreen && !reduced;

  // 一个例子从头播到尾；不在屏幕上或减弱动效时停在成品上。换了例子（index 变了）就从头再播
  // biome-ignore lint/correctness/useExhaustiveDependencies: index 不在里面用，但它一变就要重播
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
      const p = Math.min(1, (now - started) / TYPE_MS);
      setProgress(p);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const timers = [
      setTimeout(() => setPhase("finishing"), TYPE_MS),
      setTimeout(() => setPhase("done"), TYPE_MS + FINISH_MS),
      setTimeout(() => setPhase("written"), TYPE_MS + FINISH_MS + DONE_MS),
      setTimeout(() => setIndex((i) => (i + 1) % examples.length), TYPE_MS + FINISH_MS + DONE_MS + HOLD_MS),
    ];
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    };
  }, [playing, index, examples.length]);

  const example = examples[index];
  const parts = cutMarks(example.said);
  const total = parts.reduce((sum, part) => sum + part.text.length, 0);
  let shown = Math.round(total * progress);
  let cuts = 0;
  const written = phase === "written";
  const barState = phase === "talk" ? "recording" : phase === "finishing" ? "finishing" : "done";

  return (
    <Section id="demo" labelledBy="demo-title">
      <Heading id="demo-title" title={m.demo.title} lead={m.demo.lead} />

      <div ref={root} className="reveal mt-[clamp(3rem,7vw,5rem)]">
        <div className="mb-6 flex gap-1.5" role="tablist">
          {examples.map((item, i) => (
            <button
              key={item.label}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => setIndex(i)}
              className={`h-8 cursor-pointer rounded-full px-4 text-sm font-medium transition-colors duration-200 ${
                i === index ? "bg-ink text-canvas" : "text-ink-2 hover:bg-surface hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid items-stretch gap-4 md:grid-cols-2 md:gap-6">
          <div className="relative flex min-h-[17rem] flex-col rounded-[1.75rem] bg-surface p-7 sm:p-9">
            <p className="text-sm font-medium text-ink-2">{m.demo.said}</p>
            <p className="mt-4 text-[clamp(1.125rem,1.9vw,1.375rem)] leading-relaxed text-ink-2">
              {/* 读屏读完整的一句；下面逐字出现的那些只是画面 */}
              <span className="sr-only">{example.said.replaceAll("~~", "")}</span>
              {parts.map((part, i) => {
                const visible = part.text.slice(0, Math.max(0, shown));
                shown -= part.text.length;
                if (part.cut) cuts += 1;
                if (!visible) return null;
                return (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: 片段的顺序是固定的
                    key={i}
                    aria-hidden="true"
                    // 删掉的部分从前往后依次淡下去，像被拿走了；留下的字不动
                    style={part.cut ? { transitionDelay: written ? `${cuts * 110}ms` : "0ms" } : undefined}
                    className={`transition-[color,filter] duration-700 ease-out-quint motion-reduce:transition-none ${
                      part.cut && written ? "text-ink/28 blur-[1px]" : "text-ink"
                    }`}
                  >
                    {visible}
                  </span>
                );
              })}
              {phase === "talk" ? (
                <span
                  className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 animate-pulse bg-cinnabar"
                  aria-hidden="true"
                />
              ) : null}
            </p>
            <div className="mt-auto flex justify-center pt-8">
              <Bar state={barState} />
            </div>
          </div>

          <div className="relative flex min-h-[17rem] flex-col rounded-[1.75rem] bg-raised p-7 shadow-[0_0_0_1px_var(--color-line),0_24px_60px_-28px_oklch(0_0_0/0.35)] sm:p-9">
            <p className="text-sm font-medium text-ink-2">{m.demo.written}</p>
            <p
              key={`${index}-${written}`}
              className={`mt-4 text-[clamp(1.125rem,1.9vw,1.375rem)] leading-relaxed whitespace-pre-line text-ink ${
                written ? "motion-safe:animate-[fade-in_600ms_var(--ease-out-quint)]" : "opacity-0"
              }`}
            >
              {example.written}
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
