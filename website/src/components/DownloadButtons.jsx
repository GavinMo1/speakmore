import { links } from "../config.js";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";
import { fillText } from "../lib/text.js";

// 每种芯片配它自己的标志，都是单色、跟着字的颜色。Intel 的标志是一行字，扁，要放大到和字一样高
const CHIPS = [
  { arch: "arm64", icon: "apple", size: "size-5 -translate-y-px" },
  { arch: "x64", icon: "intel", size: "h-9 w-9 -my-2" },
];

/** 两种芯片的安装包：同一个样式、同样宽，并排放，不分主次 */
export function DownloadButtons({ className = "", style }) {
  const { m } = useI18n();
  return (
    <div className={`grid w-full max-w-md grid-cols-1 gap-3 sm:max-w-xl sm:grid-cols-2 ${className}`} style={style}>
      {CHIPS.map(({ arch, icon, size }) => (
        <a
          key={arch}
          href={links.dmg[arch]}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-6 font-semibold whitespace-nowrap text-canvas transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.98]"
        >
          <Icon name={icon} className={`shrink-0 ${size}`} />
          {fillText(m.download.button, { chip: m.download.chips[arch] })}
        </a>
      ))}
    </div>
  );
}
