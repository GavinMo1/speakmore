import { Heading, Section } from "../components/Section.jsx";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";

/** 两家模型并排：只有两样东西要比，并排放两块正合适 */
export function Models() {
  const { m } = useI18n();
  return (
    <Section id="models" labelledBy="models-title">
      <Heading id="models-title" title={m.models.title} lead={m.models.lead} />
      <div className="reveal mx-auto mt-[clamp(3rem,7vw,5rem)] grid max-w-4xl gap-4 md:grid-cols-[1.15fr_1fr] md:gap-6">
        <Provider icon="geminiColor" provider={m.models.gemini} badge={m.models.default} featured />
        <Provider icon="openai" provider={m.models.openai} />
      </div>
    </Section>
  );
}

function Provider({ icon, provider, badge, featured = false }) {
  return (
    <article
      className={`flex flex-col rounded-[1.75rem] p-8 sm:p-10 ${
        featured ? "bg-raised shadow-[0_0_0_1px_var(--color-line),0_24px_60px_-30px_oklch(0_0_0/0.3)]" : "bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <Icon name={icon} className={`size-14 ${featured ? "" : "text-ink"}`} />
        {badge ? (
          <span className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-canvas">{badge}</span>
        ) : null}
      </div>
      <h3 className="mt-8 font-display text-3xl font-semibold tracking-tight">{provider.name}</h3>
      <p className="mt-1 font-mono text-sm text-ink-2">{provider.model}</p>
      <ul className="mt-8 space-y-3">
        {provider.facts.map((fact) => (
          <li key={fact} className="flex items-center gap-3 text-ink">
            <Icon name="check" className="size-5 text-link" />
            {fact}
          </li>
        ))}
      </ul>
    </article>
  );
}
