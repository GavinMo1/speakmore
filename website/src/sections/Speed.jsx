import { useRef } from "react";
import { Rolling } from "../components/Rolling.jsx";
import { Heading, Section } from "../components/Section.jsx";
import { useI18n } from "../i18n/index.jsx";
import { useEnterOnce, useOnScreen } from "../lib/usePageMotion.js";

/**
 * 性能：近黑的一段（和首屏、各段的白拉开）。左边一个大数（松开到出字不到 2 秒），右边四个小数（两种机器上的转写、
 * 模型多大、占多少内存）；滚到时数字像计数器一样转到位。下面一条近三分钟的录音波形，从头到尾走一遍，表示长录音完整成文。
 * 数字都是实测（README 的评测一节、bench/results/），页面上不写出处
 */
export function Speed() {
  const { m } = useI18n();
  const text = m.speed;
  const roll = useEnterOnce();
  return (
    <Section id="speed" tone="ink" labelledBy="speed-title">
      <Heading id="speed-title" title={text.title} lead={text.lead} />

      <div
        ref={roll.ref}
        data-roll={roll.stage}
        className="reveal mt-[clamp(3.5rem,8vw,6rem)] grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
      >
        <dl className="flex flex-col-reverse justify-end gap-3 lg:border-r lg:border-line lg:pr-16">
          <dt className="text-lg text-ink-2">{text.headline.label}</dt>
          <dd className="font-rounded text-[clamp(5rem,12vw,8.5rem)] leading-[1.1] font-semibold tracking-[-0.03em] text-ink">
            <span className="mr-1 text-[0.55em] font-medium text-ink-2">{text.headline.prefix}</span>
            <Rolling value={text.headline.value} />
            <span className="ml-2 text-[0.32em] font-medium tracking-normal text-ink-2">{text.headline.unit}</span>
          </dd>
        </dl>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-10 self-center">
          {text.stats.map((stat) => (
            // 数字在上、说明在下（dt 得写在前面，所以倒过来排）；说明折成两行时数字照样顶着对齐
            <div key={stat.label} className="flex flex-col-reverse justify-end gap-2">
              <dt className="text-[0.9375rem] leading-snug text-balance break-keep text-ink-2">{stat.label}</dt>
              <dd className="font-rounded text-[clamp(2.25rem,4.4vw,3.25rem)] leading-[1.25] font-semibold tracking-tight whitespace-nowrap text-ink">
                <Rolling value={stat.value} />
                <span className="ml-1.5 text-[0.45em] font-medium tracking-normal text-ink-2">{stat.unit}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <LongTake text={text.long} />
    </Section>
  );
}

/** 一段近三分钟的口述画成波形：有起伏、有停顿。固定的一串，每次都一样（不用随机数，免得每次构建不同） */
const BARS = Array.from({ length: 132 }, (_, i) => {
  const phrase = Math.sin(i * 0.19) * 0.5 + Math.sin(i * 0.071 + 1.3) * 0.35;
  const syllable = Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.83));
  const pause = i % 29 > 25 ? 0.15 : 1;
  return Math.max(0.08, Math.min(1, (0.35 + phrase * 0.3 + syllable * 0.55) * pause));
});

/** 长录音：波形从左往右亮起来，走到头说完整成文。不在屏幕上时不走；减弱动态效果时直接是亮的 */
function LongTake({ text }) {
  const ref = useRef(null);
  const seen = useOnScreen(ref);
  return (
    <div
      ref={ref}
      className="reveal mt-[clamp(4.5rem,10vw,7.5rem)] grid gap-8 border-t border-line pt-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:items-center lg:gap-16"
    >
      <div>
        <h3 className="text-[clamp(1.375rem,2.4vw,1.75rem)] font-semibold tracking-[-0.015em] text-ink">
          {text.title}
        </h3>
        <p className="mt-2 text-ink-2">{text.text}</p>
      </div>
      <div aria-hidden="true">
        <div className="long-take" data-play={seen ? "" : undefined}>
          {[0, 1].map((layer) => (
            <div key={layer} className="long-take-bars">
              {BARS.map((height, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 波形是固定的一串
                <i key={index} style={{ height: `${height * 100}%` }} />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between font-rounded text-sm text-ink-2 tabular-nums">
          <span>{text.start}</span>
          <span>{text.end}</span>
        </div>
      </div>
    </div>
  );
}
