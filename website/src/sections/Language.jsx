import { Heading, Section } from "../components/Section.jsx";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";

/** 一句中英混着说的话（App 的真实输出），英文词标出来；下面是界面支持的两种语言 */
export function Language() {
  const { m } = useI18n();
  // 成品里的英文词（连着的拉丁字母和数字）用印的靛青标出来
  const pieces = m.language.written.split(/([A-Za-z][A-Za-z0-9]*)/).filter(Boolean);
  return (
    <Section id="language" tone="surface" labelledBy="language-title">
      <div className="grid items-center gap-[clamp(3rem,7vw,6rem)] lg:grid-cols-2">
        <Heading id="language-title" title={m.language.title} lead={m.language.lead} align="left" />
        <div className="reveal">
          <div className="rounded-[1.75rem] bg-raised p-7 shadow-[0_0_0_1px_var(--color-line),0_24px_60px_-30px_oklch(0_0_0/0.3)] sm:p-9">
            <p className="flex items-start gap-2.5 text-[0.9375rem] text-ink-2">
              <Icon name="mic" className="mt-0.5 size-4 shrink-0" />
              <span lang="zh-CN">{m.language.said}</span>
            </p>
            <p lang="zh-CN" className="mt-5 text-[clamp(1.25rem,2.2vw,1.625rem)] leading-relaxed font-medium text-ink">
              {pieces.map((piece, index) =>
                /^[A-Za-z]/.test(piece) ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 片段的顺序是固定的
                  <mark key={index} lang="en" className="rounded-md bg-link/12 px-1 text-link">
                    {piece}
                  </mark>
                ) : (
                  piece
                ),
              )}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2.5 text-sm">
            <Icon name="translate" className="size-5 text-ink-2" />
            <span className="text-ink-2">{m.language.ui}</span>
            {m.language.uiLanguages.map((name) => (
              <span key={name} className="rounded-full bg-raised px-3 py-1 font-medium text-ink ring-1 ring-line">
                {name}
              </span>
            ))}
            <span className="text-ink-2">{m.language.uiNote}</span>
          </div>
        </div>
      </div>
    </Section>
  );
}
