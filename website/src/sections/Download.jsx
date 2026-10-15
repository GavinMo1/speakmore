import seal from "../../../assets/icon.svg";
import { CopyCommand } from "../components/CopyCommand.jsx";
import { DownloadButtons } from "../components/DownloadButtons.jsx";
import { Lines } from "../components/Section.jsx";
import { links } from "../config.js";
import { useI18n } from "../i18n/index.jsx";
import { fill, fillText } from "../lib/text.js";

/** 最后一屏：两种芯片的安装包，或者终端里一行；页脚也在这里 */
export function Download() {
  const { m } = useI18n();
  const keyLink = (href, label) => (
    <a key={href} href={href} className="text-link hover:underline">
      {label}
    </a>
  );
  return (
    <section id="download" className="bg-canvas text-ink" aria-labelledby="download-title">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-5 pt-[clamp(5.5rem,13vw,10rem)] text-center sm:px-8">
        <img src={seal} alt="" width="80" height="80" className="reveal size-20" />
        <h2 id="download-title" className="display reveal mt-8 text-[clamp(2.75rem,7vw,5rem)]">
          <Lines text={m.download.title} />
        </h2>
        <p className="reveal mt-4 text-[clamp(1.0625rem,1.8vw,1.375rem)] font-medium text-ink-2">{m.download.lead}</p>

        <DownloadButtons className="reveal mt-12" />
        <p className="reveal mt-4 text-sm text-ink-2">
          {m.download.whichChip} {fillText(m.download.version, { version: links.version })}
        </p>

        <div className="reveal mt-14 w-full max-w-2xl text-left">
          <p className="mb-3 text-center text-sm font-medium text-ink-2">{m.download.terminal}</p>
          <CopyCommand command={links.install} copyLabel={m.download.copy} copiedLabel={m.download.copied} />
        </div>
        <p className="reveal mt-8 text-sm text-ink-2">
          {fill(m.download.needs, {
            gemini: keyLink(links.geminiKey, m.download.geminiKey),
            openai: keyLink(links.openaiKey, m.download.openaiKey),
          })}
        </p>
      </div>

      <footer className="mx-auto mt-[clamp(5rem,12vw,9rem)] flex max-w-6xl flex-col items-center justify-between gap-4 border-t border-line px-5 py-8 text-xs text-ink-2 sm:flex-row sm:px-8">
        <p className="flex items-center gap-2">
          <img src={seal} alt="" width="16" height="16" className="size-4" />
          SpeakMore
        </p>
        <p className="flex gap-5">
          <a href={links.license} className="hover:text-ink">
            {m.footer.license}
          </a>
          <a href={links.repository} className="hover:text-ink">
            {m.footer.source}
          </a>
        </p>
      </footer>
    </section>
  );
}
