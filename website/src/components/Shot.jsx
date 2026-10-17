import { readme } from "../config.js";
import { useI18n } from "../i18n/index.jsx";

/** README 那批图四周给阴影留的边（CSS 像素，website/scripts/readme-media.mjs 的 pad） */
const PAD = 40;

/**
 * README 那批截图之一：真窗口截图，Mac 窗口的外框和阴影都画在图里，这里不再套框。
 * 图四周留着给阴影的边：往外撑出去，让窗口本身的左右边和这一栏对齐。
 * dark：系统是深色时换成的那一张（同样大小）
 */
export function Shot({ name, dark, alt, className = "", loading = "lazy", fetchPriority }) {
  const { locale } = useI18n();
  const light = readme(name, locale);
  const night = dark ? readme(dark, locale) : null;
  const inner = light.width - PAD * 2;
  return (
    <picture
      className={`block ${className}`}
      style={{ width: `calc(100% * ${light.width} / ${inner})`, marginInline: `calc(-100% * ${PAD} / ${inner})` }}
    >
      {night ? <source media="(prefers-color-scheme: dark)" srcSet={night.src} /> : null}
      <img
        src={light.src}
        width={light.width}
        height={light.height}
        alt={alt}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
        className="block h-auto w-full"
      />
    </picture>
  );
}
