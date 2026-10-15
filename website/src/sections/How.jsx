import { Bar } from "../components/Bar.jsx";
import { Keycap } from "../components/Keycap.jsx";
import { Heading, Section } from "../components/Section.jsx";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";
import { fill } from "../lib/text.js";

// 字能落进去的那些应用：原色的标志
const APPS = ["wechat", "slack", "notion", "vscode", "chrome", "gmail", "obsidian", "figma", "telegram"];

/** 按一下、说、再按一下：三步真有先后，所以排成一行带箭头 */
export function How() {
  const { m } = useI18n();
  return (
    <Section id="how" tone="surface" labelledBy="how-title">
      <Heading id="how-title" title={m.how.title} lead={m.how.lead} />

      <ol className="reveal mx-auto mt-[clamp(3rem,7vw,5rem)] flex max-w-3xl flex-col items-center justify-center gap-6 sm:flex-row sm:items-start sm:gap-4">
        {m.how.steps.map((step) => (
          <li key={step.text} className="flex items-center gap-4 sm:flex-1 sm:flex-col sm:gap-5">
            <div className="grid h-16 w-40 place-items-center">
              {step.key ? <Keycap size="lg">{step.key}</Keycap> : <Bar state="recording" />}
            </div>
            <p className="w-24 text-left text-lg font-semibold sm:w-auto sm:text-center">{step.text}</p>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-center text-sm text-ink-2">
        {fill(m.how.cancel, {
          esc: (
            <kbd key="esc" className="font-sans font-semibold text-ink">
              esc
            </kbd>
          ),
        })}
      </p>

      <div className="reveal mt-[clamp(3.5rem,8vw,6rem)] flex flex-col items-center gap-6">
        <ul className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          {APPS.map((app) => (
            <li
              key={app}
              className="grid size-14 place-items-center rounded-2xl bg-raised shadow-[0_0_0_1px_var(--color-line),0_8px_20px_-12px_oklch(0_0_0/0.3)] sm:size-16"
            >
              <Icon name={app} className="size-7 sm:size-8" />
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-2">{m.how.apps}</p>
        <p className="mt-4 flex items-baseline gap-3">
          <span className="font-rounded text-4xl font-semibold tracking-tight text-ink">{m.how.speedValue}</span>
          <span className="text-ink-2">{m.how.speedLabel}</span>
        </p>
      </div>
    </Section>
  );
}
