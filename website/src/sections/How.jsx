import { Bar } from "../components/Bar.jsx";
import { Keycap } from "../components/Keycap.jsx";
import { Heading, Section } from "../components/Section.jsx";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";

// 字能落进去的那些应用：原色的标志
const APPS = ["wechat", "slack", "notion", "vscode", "chrome", "gmail", "obsidian", "figma", "telegram"];

// 三步在宽屏上铺满整行：第一步贴左、中间居中、最后一步贴右，和上面的标题、右边那句话的边对齐；一道细线从键帽后面穿过去连起来
const STEP_ALIGN = ["sm:items-start sm:text-left", "sm:items-center sm:text-center", "sm:items-end sm:text-right"];

/** 按一下、说、再按一下：三步真有先后，所以排成一行连起来。下面左边是能用的应用，右边是多快出字 */
export function How() {
  const { m } = useI18n();
  return (
    <Section id="how" tone="surface" labelledBy="how-title">
      <Heading id="how-title" title={m.how.title} lead={m.how.lead} />

      <ol className="reveal relative mt-[clamp(3rem,7vw,5rem)] flex flex-col gap-6 sm:flex-row sm:justify-between sm:before:absolute sm:before:inset-x-0 sm:before:top-8 sm:before:h-px sm:before:bg-line">
        {m.how.steps.map((step, index) => (
          <li key={step.text} className={`relative flex items-center gap-4 sm:flex-col sm:gap-5 ${STEP_ALIGN[index]}`}>
            <div className="grid h-16 w-40 place-items-center justify-items-start sm:w-auto">
              {step.key ? <Keycap size="lg">{step.key}</Keycap> : <Bar state="recording" />}
            </div>
            <p className="text-lg font-semibold">{step.text}</p>
          </li>
        ))}
      </ol>

      <div className="reveal mt-[clamp(3.5rem,8vw,6rem)] flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <ul className="flex flex-wrap items-center gap-3 sm:gap-4">
          {APPS.map((app) => (
            <li
              key={app}
              className="grid size-14 place-items-center rounded-2xl bg-raised shadow-[0_0_0_1px_var(--color-line),0_8px_20px_-12px_oklch(0_0_0/0.3)] sm:size-16"
            >
              <Icon name={app} className="size-7 sm:size-8" />
            </li>
          ))}
        </ul>
        <p className="flex items-baseline gap-3">
          <span className="font-rounded text-4xl font-semibold tracking-tight text-ink">{m.how.speedValue}</span>
          <span className="text-ink-2">{m.how.speedLabel}</span>
        </p>
      </div>
    </Section>
  );
}
