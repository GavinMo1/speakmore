import { links } from "../config.js";
import { useI18n } from "../i18n/index.jsx";
import { Icon } from "../icons/Icon.jsx";

// 每个安装包配它自己的标志，都是单色、跟着字的颜色。Intel 的标志是一行字，扁，要放大到和字一样高
const TARGETS = [
  { id: "arm64", icon: "apple", size: "size-5 -translate-y-px" },
  { id: "x64", icon: "intel", size: "h-9 w-9 -my-2" },
  { id: "windows", icon: "windows", size: "size-[1.125rem]" },
];

/** 三个安装包（两种芯片的 Mac、Windows）：同一个样式、同样宽，并排放，不分主次 */
export function DownloadButtons({ className = "", style }) {
  const { m } = useI18n();
  return (
    <div className={`grid w-full max-w-md grid-cols-1 gap-3 sm:max-w-4xl sm:grid-cols-3 ${className}`} style={style}>
      {TARGETS.map(({ id, icon, size }) => (
        <a
          key={id}
          href={links.downloads[id]}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-6 font-semibold whitespace-nowrap text-canvas transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.98]"
        >
          <Icon name={icon} className={`shrink-0 ${size}`} />
          {m.download.buttons[id]}
        </a>
      ))}
    </div>
  );
}
