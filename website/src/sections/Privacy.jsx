import { Heading, Section } from "../components/Section.jsx";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";

/** 一张路线图：你的 Mac 直接连到模型，中间那台"中转服务器"是划掉的；下面四条怎么做到的 */
export function Privacy() {
  const { m } = useI18n();
  return (
    <Section id="privacy" tone="ink" labelledBy="privacy-title">
      <Heading id="privacy-title" title={m.privacy.title} lead={m.privacy.lead} />

      <div className="reveal mx-auto mt-[clamp(3rem,7vw,5rem)] grid max-w-4xl grid-cols-[auto_1fr_auto] items-start gap-3 sm:gap-6">
        <Node icon="laptop" label={m.privacy.mac} />
        <div className="relative flex flex-col items-center self-start pt-7 sm:pt-8">
          {/* 一条直线从 Mac 连到模型；中间那一站是划掉的，因为根本没有 */}
          <div className="relative h-px w-full bg-ink-2/60">
            <span className="absolute -top-[3.5px] right-0 size-2 rotate-45 border-t border-r border-ink-2" />
          </div>
          <div className="absolute top-7 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-dashed border-line bg-[oklch(0.13_0.008_255)] px-4 py-2.5 text-center sm:top-8">
            <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-ink-2 line-through decoration-cinnabar-glow decoration-2">
              <Icon name="cloudOff" className="size-4" />
              {m.privacy.middle}
            </span>
            <span className="text-xs font-semibold text-cinnabar-glow">{m.privacy.none}</span>
          </div>
          <span className="mt-12 inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
            <Icon name="key" className="size-3.5" />
            {m.privacy.key}
          </span>
        </div>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex -space-x-2">
            <span className="grid size-14 place-items-center rounded-2xl bg-raised ring-1 ring-line sm:size-16">
              <Icon name="geminiColor" className="size-7 sm:size-8" />
            </span>
            <span className="grid size-14 place-items-center rounded-2xl bg-raised text-ink ring-1 ring-line sm:size-16">
              <Icon name="openai" className="size-7 sm:size-8" />
            </span>
          </div>
          <span className="text-sm font-medium text-ink">{m.privacy.provider}</span>
        </div>
      </div>

      <ul className="reveal mx-auto mt-[clamp(3.5rem,8vw,6rem)] grid max-w-4xl gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {m.privacy.points.map((point) => (
          <li key={point.title}>
            <Icon name={point.icon} className="size-6 text-ink" />
            <p className="mt-3 font-semibold text-ink">{point.title}</p>
            <p className="mt-1 text-sm text-ink-2">{point.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Node({ icon, label }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-raised text-ink ring-1 ring-line sm:size-16">
        <Icon name={icon} className="size-7 sm:size-8" />
      </span>
      <span className="text-sm font-medium text-ink">{label}</span>
    </div>
  );
}
