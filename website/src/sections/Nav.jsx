import { useEffect, useState } from "react";
import seal from "../../../assets/icon.svg";
import { links } from "../config.js";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";

/**
 * 吸顶导航。停在首屏上时是透明的、白字（首屏是深色）；往下滚了就换成半透明的毛玻璃，字跟着页面的颜色。
 * 窄屏只留标志、语言和下载
 */
export function Nav() {
  const { m, switchLocale } = useI18n();
  // 三种样子：停在首屏顶上是透明的；滚到深色的段落上是深色毛玻璃；别处是跟着系统的毛玻璃
  const [look, setLook] = useState("clear");

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (window.scrollY <= 24) return setLook("clear");
      // 导航正下方是哪一段
      const below = document.elementFromPoint(window.innerWidth / 2, 64)?.closest("section");
      setLook(below?.matches(".tone-night, .tone-ink") ? "dark" : "glass");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const items = [
    ["how", m.nav.how],
    ["cost", m.nav.cost],
    ["privacy", m.nav.privacy],
  ];

  return (
    <header
      className={`fixed inset-x-0 top-0 z-30 text-ink transition-[background-color,box-shadow] duration-300 ${
        {
          clear: "tone-night bg-none! bg-transparent!",
          dark: "tone-night bg-none! bg-[oklch(0.14_0.02_258/0.72)]! shadow-[0_1px_0_var(--color-line)] backdrop-blur-xl backdrop-saturate-150",
          glass: "bg-canvas/72 shadow-[0_1px_0_var(--color-line)] backdrop-blur-xl backdrop-saturate-150",
        }[look]
      }`}
    >
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5 sm:px-8">
        <a
          href="#top"
          className="flex items-center gap-2.5 font-display text-[1.0625rem] font-semibold tracking-[-0.01em]"
          aria-label={m.nav.home}
        >
          <img src={seal} alt="" width="28" height="28" className="size-7" />
          SpeakMore
        </a>
        <ul className="ml-auto hidden items-center gap-7 text-sm text-ink-2 md:flex">
          {items.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="transition-colors duration-150 hover:text-ink">
                {label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <button
            type="button"
            onClick={switchLocale}
            aria-label={m.nav.switchLabel}
            className="grid h-9 min-w-9 cursor-pointer place-items-center rounded-full px-2.5 text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-surface hover:text-ink"
          >
            {m.nav.switchTo}
          </button>
          <a
            href={links.repository}
            aria-label={m.nav.github}
            className="grid size-9 place-items-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-surface hover:text-ink"
          >
            <Icon name="github" className="size-5" />
          </a>
          <a
            href="#download"
            className="ml-1.5 inline-flex h-8 items-center rounded-full bg-cinnabar px-3.5 text-[0.8125rem] font-semibold text-white transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.97]"
          >
            {m.nav.download}
          </a>
        </div>
      </nav>
    </header>
  );
}
