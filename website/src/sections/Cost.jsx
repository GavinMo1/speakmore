import { Heading, Section } from "../components/Section.jsx";
import { useI18n } from "../i18n/index.jsx";

// 一年的钱：Typeless Pro 年付 $144；SpeakMore 用 Gemini 约 $0.67–1.05 一个月，取 $12 一年画条（出处见文案里的 note）
const TYPELESS_YEAR = 144;
const SPEAKMORE_YEAR = 12;

export function Cost() {
  const { m } = useI18n();
  const rows = [
    { name: m.cost.typeless, value: m.cost.typelessValue, share: 1, bar: "bg-ink-2/35" },
    { name: m.cost.speakmore, value: m.cost.speakmoreValue, share: SPEAKMORE_YEAR / TYPELESS_YEAR, bar: "bg-cinnabar" },
  ];
  return (
    <Section id="cost" labelledBy="cost-title">
      <Heading id="cost-title" title={m.cost.title} lead={m.cost.lead} />

      <figure className="reveal mx-auto mt-[clamp(3rem,7vw,5rem)] max-w-3xl">
        <figcaption className="mb-6 text-sm font-medium text-ink-2">{m.cost.yearly}</figcaption>
        <dl className="space-y-7">
          {rows.map((row) => (
            <div key={row.name}>
              <dt className="mb-2.5 flex items-baseline justify-between gap-4">
                <span className="font-medium text-ink">{row.name}</span>
                <span className="font-rounded text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight text-ink">
                  {row.value}
                </span>
              </dt>
              <dd className="h-3 overflow-hidden rounded-full bg-surface">
                <span
                  className={`grow block h-full rounded-full ${row.bar}`}
                  style={{ width: `${Math.max(row.share * 100, 2)}%` }}
                />
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 grid grid-cols-2 gap-6 border-t border-line pt-8">
          <p>
            <span className="block font-rounded text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight">
              {m.cost.perDictationValue}
            </span>
            <span className="text-ink-2">{m.cost.perDictation}</span>
          </p>
          <p>
            <span className="block font-rounded text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight">
              {m.cost.freeTierValue}
            </span>
            <span className="text-ink-2">{m.cost.freeTier}</span>
          </p>
        </div>
        <p className="mt-10 text-xs leading-relaxed text-ink-2 text-pretty">{m.cost.note}</p>
      </figure>
    </Section>
  );
}
