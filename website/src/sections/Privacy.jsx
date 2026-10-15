import { Heading, Section } from "../components/Section.jsx";
import { links } from "../config.js";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";
import { fill } from "../lib/text.js";

/** 一句话就讲得完的几样放在一排：直连模型、两家模型、开源、两种界面语言。每样配自己的图，不套卡片 */
export function Privacy() {
  const { m } = useI18n();
  const text = m.privacy;
  const github = (
    <a
      key="github"
      href={links.repository}
      className="text-ink underline decoration-ink-2/50 underline-offset-4 transition-colors duration-150 hover:decoration-ink"
    >
      GitHub
    </a>
  );
  const items = [
    { id: "direct", ...text.direct, visual: <Icon name="lock" className="size-10 text-ink" /> },
    {
      id: "models",
      ...text.models,
      visual: (
        <span className="flex items-center gap-4">
          <Icon name="geminiColor" className="size-10" />
          <Icon name="openai" className="size-10 text-ink" />
        </span>
      ),
    },
    {
      id: "open",
      ...text.open,
      text: fill(text.open.text, { github }),
      visual: <Icon name="github" className="size-10 text-ink" />,
    },
    { id: "languages", ...text.languages, visual: <Icon name="translate" className="size-10 text-ink" /> },
  ];

  return (
    <Section id="privacy" tone="ink" labelledBy="privacy-title">
      <Heading id="privacy-title" title={text.title} />
      <ul className="reveal mt-[clamp(3.5rem,8vw,6rem)] grid gap-y-14 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-line">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col items-center px-6 text-center">
            <div className="flex h-12 items-center">{item.visual}</div>
            <h3 className="mt-7 text-lg font-semibold text-ink">{item.title}</h3>
            {/* 中文只在标点处换行，不把一个词拆到两行；一句话比一行还长时才随处断 */}
            <p className="mt-2 max-w-[17rem] text-[0.9375rem] leading-relaxed text-balance break-keep wrap-anywhere text-ink-2">
              {item.text}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
