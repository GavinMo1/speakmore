import { useState } from "react";
import { Heading, Section } from "../components/Section.jsx";
import { WindowFrame } from "../components/WindowFrame.jsx";
import { shot } from "../config.js";
import { useI18n } from "../i18n/index.jsx";
import { fillText } from "../lib/text.js";

const THEMES = ["ink", "cinnabar", "indigo"];
const SCHEMES = ["light", "dark"];
// 每套主题在选择器上的那个小色点：取 App 里这套主题最有代表性的颜色（src/themes）
const SWATCH = { ink: "oklch(0.2 0 0)", cinnabar: "oklch(0.56 0.19 32)", indigo: "oklch(0.47 0.15 262)" };

/** 换主题、换深浅色：截图跟着换，悬浮条也跟着换 */
export function Look() {
  const { m, locale } = useI18n();
  const [theme, setTheme] = useState("cinnabar");
  // 先给访客看和他系统一样深浅的那张
  const [scheme, setScheme] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const home = shot(`home-${scheme}-${theme}`, locale);
  const bar = shot(`bar-${theme}`, locale);

  return (
    <Section id="look" labelledBy="look-title">
      <Heading id="look-title" title={m.look.title} lead={m.look.lead} />

      <div className="reveal mt-10 flex flex-wrap items-center gap-3">
        <Segmented
          label={m.look.themeLabel}
          value={theme}
          onChange={setTheme}
          options={THEMES.map((id) => ({ id, label: m.look.themes[id], swatch: SWATCH[id] }))}
        />
        <Segmented
          label={m.look.schemeLabel}
          value={scheme}
          onChange={setScheme}
          options={SCHEMES.map((id) => ({ id, label: m.look.schemes[id] }))}
        />
      </div>

      <div className="reveal relative mt-10 mb-[clamp(5rem,9vw,7rem)]">
        <WindowFrame
          key={`${theme}-${scheme}`}
          {...home}
          alt={fillText(m.look.alt, { theme: m.look.themes[theme], scheme: m.look.schemes[scheme] })}
          className="motion-safe:animate-[fade-in_500ms_var(--ease-out-quint)]"
        />
        <img
          key={theme}
          src={bar.src}
          width={bar.width}
          height={bar.height}
          alt=""
          loading="lazy"
          className="absolute bottom-0 left-1/2 w-[clamp(10rem,24vw,14.5rem)] -translate-x-1/2 translate-y-[calc(100%+1.5rem)] drop-shadow-[0_18px_30px_oklch(0_0_0/0.35)] motion-safe:animate-[fade-in_500ms_var(--ease-out-quint)]"
        />
      </div>
    </Section>
  );
}

/** 一组互斥的按钮（单选）：键盘上用 Tab 进来、空格或回车选 */
function Segmented({ label, value, onChange, options }) {
  return (
    <fieldset className="flex rounded-full bg-surface p-1 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <label
            key={option.id}
            className={`flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 has-focus-visible:outline-2 has-focus-visible:outline-link ${
              selected
                ? "bg-raised text-ink shadow-[0_1px_3px_oklch(0_0_0/0.15),0_0_0_1px_var(--color-line)]"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name={label}
              value={option.id}
              checked={selected}
              onChange={() => onChange(option.id)}
              className="sr-only"
            />
            {option.swatch ? (
              <span className="size-3 rounded-full ring-1 ring-ink-2/40" style={{ background: option.swatch }} />
            ) : null}
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}
