import { Lines } from "../components/Section.jsx";
import { WindowFrame } from "../components/WindowFrame.jsx";
import { links, shot } from "../config.js";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";

/** 首屏：一句话、下载、一张主窗口的图，悬浮条压在窗口下沿，像说话时它浮在桌面上 */
export function Hero() {
  const { m, locale } = useI18n();
  const home = shot("home-dark-indigo", locale);
  const bar = shot("bar-indigo", locale);

  return (
    <section id="top" className="tone-night relative overflow-hidden text-ink" aria-labelledby="hero-title">
      <div className="mx-auto max-w-6xl px-5 pt-[clamp(7.5rem,15vw,10.5rem)] text-center sm:px-8">
        <h1 id="hero-title" className="display rise text-[clamp(3.25rem,10vw,6rem)]">
          <Lines text={m.hero.title} />
        </h1>
        <p
          className="rise mx-auto mt-6 max-w-xl text-[clamp(1.125rem,2.2vw,1.5rem)] leading-snug font-medium text-ink-2"
          style={{ "--d": "120ms" }}
        >
          <Lines text={m.hero.lead} />
        </p>

        <div
          className="rise mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-3"
          style={{ "--d": "240ms" }}
        >
          <a
            href={links.dmg.arm64}
            className="group inline-flex h-13 items-center gap-2.5 rounded-full bg-cinnabar pr-2 pl-6 text-[1.0625rem] font-semibold text-white shadow-[0_10px_30px_-8px_oklch(0.6_0.17_32/0.6)] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98]"
          >
            <Icon name="apple" className="size-5 -translate-y-px" />
            {m.hero.download}
            <span className="rounded-full bg-white/18 px-2.5 py-1 text-xs font-medium">{m.hero.chip}</span>
          </a>
          <a
            href={links.dmg.x64}
            className="inline-flex items-center gap-1 text-[0.9375rem] font-medium text-link hover:underline"
          >
            {m.hero.intel}
            <Icon name="arrowRight" className="size-4" />
          </a>
        </div>
        <p className="rise mt-5 text-sm text-ink-2" style={{ "--d": "300ms" }}>
          {m.hero.facts.join(" · ")}
        </p>
      </div>

      <div
        className="rise mx-auto mt-[clamp(3.5rem,8vw,5.5rem)] max-w-5xl px-5 pb-[clamp(8rem,15vw,11rem)] sm:px-8"
        style={{ "--d": "420ms" }}
      >
        <div className="relative">
          <WindowFrame {...home} alt={m.hero.shotAlt} loading="eager" fetchPriority="high" />
          {/* 说话时那条悬浮条：在窗口正下方，像说话时它浮在桌面上 */}
          <img
            src={bar.src}
            width={bar.width}
            height={bar.height}
            alt={m.hero.barAlt}
            className="absolute bottom-0 left-1/2 w-[clamp(10rem,24vw,14.5rem)] -translate-x-1/2 translate-y-[calc(100%+1.5rem)] drop-shadow-[0_18px_30px_oklch(0_0_0/0.45)]"
          />
        </div>
      </div>
    </section>
  );
}
