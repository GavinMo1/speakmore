import { links } from "../config.js";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";
import { fillText } from "../lib/text.js";

/** 两种芯片的安装包：同一个样式、同样宽，并排放，不分主次 */
export function DownloadButtons({ className = "", style }) {
  const { m } = useI18n();
  const chips = [
    ["arm64", m.download.chips.arm64],
    ["x64", m.download.chips.x64],
  ];
  return (
    <div className={`grid w-full max-w-md grid-cols-1 gap-3 sm:max-w-xl sm:grid-cols-2 ${className}`} style={style}>
      {chips.map(([arch, chip]) => (
        <a
          key={arch}
          href={links.dmg[arch]}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-6 font-semibold whitespace-nowrap text-canvas transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.98]"
        >
          <Icon name="download" className="size-[1.125rem]" />
          {fillText(m.download.button, { chip })}
        </a>
      ))}
    </div>
  );
}
