import { Rolling } from "../components/Rolling.jsx";
import { Heading, Section } from "../components/Section.jsx";
import { costs } from "../config.js";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";
import { useEnterOnce } from "../lib/usePageMotion.js";

/** 中文写人民币，英文写美元；到分，不花钱的写 0（和 App 模型页推荐组合的写法一样） */
function price(plan, locale) {
  const [symbol, value] = locale === "zh-CN" ? ["¥", plan.cny] : ["$", plan.usd];
  return { symbol, value: value === 0 ? "0" : value.toFixed(2) };
}

/**
 * 费用：只列两个方案。左边是推荐的付费方案（本机转写加润色，每天 100 次每月几块钱），白底、数字用朱砂；
 * 右边是免费的数据隐私方案，只有一道细边。月成本和 App 同一套算法（src/costs.json），滚到时数字转到位
 */
export function Cost() {
  const { m, locale } = useI18n();
  const roll = useEnterOnce();
  const plans = [
    { id: "paid", text: m.cost.paid, cost: price(costs.paid, locale) },
    { id: "free", text: m.cost.free, cost: price(costs.free, locale) },
  ];
  return (
    <Section id="cost" labelledBy="cost-title">
      <Heading id="cost-title" title={m.cost.title} lead={m.cost.lead} />

      <div
        ref={roll.ref}
        data-roll={roll.stage}
        className="reveal mt-[clamp(3.5rem,8vw,6rem)] grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
      >
        {plans.map(({ id, text, cost }) => {
          const paid = id === "paid";
          return (
            <article
              key={id}
              aria-labelledby={`plan-${id}`}
              className={`flex flex-col rounded-[2rem] p-[clamp(2rem,4.5vw,3rem)] ${
                paid
                  ? "bg-raised shadow-[0_0_0_1px_var(--color-line),0_30px_70px_-34px_oklch(0_0_0/0.35)]"
                  : "shadow-[inset_0_0_0_1px_var(--color-line)]"
              }`}
            >
              <header className="flex items-baseline justify-between gap-4">
                <h3 id={`plan-${id}`} className="text-xl font-semibold tracking-[-0.01em] text-ink">
                  {text.name}
                </h3>
                {text.badge ? <p className="text-sm font-semibold text-cinnabar">{text.badge}</p> : null}
              </header>
              <p
                className={`mt-8 font-rounded leading-[1.15] font-semibold tracking-[-0.025em] whitespace-nowrap ${
                  paid ? "text-[clamp(4rem,9vw,6rem)] text-cinnabar" : "text-[clamp(3.25rem,7vw,4.5rem)] text-ink"
                }`}
              >
                <span className="mr-1 text-[0.5em]">{cost.symbol}</span>
                <Rolling value={cost.value} />
                <span className="ml-2 text-[0.26em] font-medium tracking-normal text-ink-2">{m.cost.per}</span>
              </p>
              <p className="mt-2 text-ink-2">{text.note}</p>
              {/* 要点贴着底边：两个方案的要点那一行对齐 */}
              <div className="min-h-10 flex-1" />
              <ul className="grid gap-3 border-t border-line pt-7">
                {text.points.map((point) => (
                  <li key={point} className="flex items-center gap-3 text-ink">
                    <Icon name="check" className={`size-5 shrink-0 ${paid ? "text-cinnabar" : "text-seal"}`} />
                    {point}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </Section>
  );
}
