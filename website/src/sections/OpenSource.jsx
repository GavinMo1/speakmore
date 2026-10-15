import { Heading, Section } from "../components/Section.jsx";
import { links } from "../config.js";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";

export function OpenSource() {
  const { m } = useI18n();
  return (
    <Section id="open" tone="surface" labelledBy="open-title">
      <div className="flex flex-col items-center">
        <Icon name="github" className="reveal mb-8 size-14 text-ink" />
        <Heading id="open-title" title={m.open.title} lead={m.open.lead} />
        <div className="reveal mt-10 flex flex-col items-center gap-5">
          <a
            href={links.repository}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 font-semibold text-canvas transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98]"
          >
            <Icon name="github" className="size-5" />
            {m.open.cta}
          </a>
          <a href={links.notes} className="inline-flex items-center gap-1 text-sm text-link hover:underline">
            {m.open.origin}
            <Icon name="arrowUpRight" className="size-4" />
          </a>
        </div>
      </div>
    </Section>
  );
}
