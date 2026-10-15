import seal from "../../../assets/icon.svg";
import { DownloadButtons } from "../components/DownloadButtons.jsx";
import { Lines } from "../components/Section.jsx";
import { WindowFrame } from "../components/WindowFrame.jsx";
import { shot } from "../config.js";
import { useI18n } from "../i18n/index.jsx";

/** 首屏：图标、一句话、两个下载、一张主窗口的图（跟着系统深浅换），悬浮条在窗口正下方 */
export function Hero() {
  const { m, locale } = useI18n();
  const bar = shot("bar-ink", locale);

  return (
    <section id="top" className="overflow-hidden bg-canvas text-ink" aria-labelledby="hero-title">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-5 pt-[clamp(7rem,13vw,9.5rem)] text-center sm:px-8">
        <img src={seal} alt="" width="80" height="80" className="rise size-[clamp(4rem,7vw,5rem)]" />
        <h1 id="hero-title" className="display rise mt-8 text-[clamp(3rem,9vw,5.75rem)]" style={{ "--d": "80ms" }}>
          <Lines text={m.hero.title} />
        </h1>
        <p
          className="rise mt-6 max-w-xl text-[clamp(1.125rem,2.2vw,1.5rem)] leading-snug font-medium text-balance text-ink-2"
          style={{ "--d": "160ms" }}
        >
          <Lines text={m.hero.lead} />
        </p>
        <DownloadButtons className="rise mt-10" style={{ "--d": "240ms" }} />
      </div>

      <div
        className="rise mx-auto mt-[clamp(3.5rem,8vw,5.5rem)] max-w-5xl px-5 pb-[clamp(8rem,15vw,11rem)] sm:px-8"
        style={{ "--d": "420ms" }}
      >
        <div className="relative">
          <WindowFrame
            {...shot("home-light-ink", locale)}
            dark={shot("home-dark-ink", locale)}
            alt={m.hero.shotAlt}
            loading="eager"
            fetchPriority="high"
          />
          {/* 说话时那条悬浮条：在窗口正下方，像说话时它浮在桌面上 */}
          <img
            src={bar.src}
            width={bar.width}
            height={bar.height}
            alt={m.hero.barAlt}
            className="absolute bottom-0 left-1/2 w-[clamp(10rem,24vw,14.5rem)] -translate-x-1/2 translate-y-[calc(100%+1.5rem)] drop-shadow-[0_14px_24px_oklch(0_0_0/0.28)]"
          />
        </div>
      </div>
    </section>
  );
}
