import { Heading, Section } from "../components/Section.jsx";
import { useI18n } from "../i18n/index.jsx";

/**
 * 花多少钱：一张账单式的清单，左边是哪一项，右边是钱。文案里标了 highlight 的那一行（每月）用朱砂标出来。
 * 数字的出处在文案的 note 里（README 成本一节：作者的真实用量、Gemini 的官方价）
 */
export function Cost() {
  const { m } = useI18n();
  return (
    <Section id="cost" labelledBy="cost-title">
      <Heading id="cost-title" title={m.cost.title} lead={m.cost.lead} />

      <figure className="reveal mx-auto mt-[clamp(3rem,7vw,5rem)] max-w-3xl">
        <dl className="border-t border-line">
          {m.cost.items.map((item) => (
            <div
              key={item.label}
              className="flex items-baseline justify-between gap-6 border-b border-line py-6 sm:py-7"
            >
              <dt className={item.highlight ? "font-medium text-ink" : "text-ink-2"}>{item.label}</dt>
              <dd
                className={`font-rounded text-[clamp(1.75rem,4.2vw,2.75rem)] leading-none font-semibold tracking-tight whitespace-nowrap ${
                  item.highlight ? "text-cinnabar" : "text-ink"
                }`}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
        <figcaption className="mt-8 text-xs leading-relaxed text-ink-2 text-pretty">{m.cost.note}</figcaption>
      </figure>
    </Section>
  );
}
