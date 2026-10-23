import { readme } from "../config.js";
import { useI18n } from "../i18n/index.jsx";

/** README 那批图四周给阴影留的边（CSS 像素）：窗口截图是 readme-media.mjs 的 40，划词的实拍是 readme-scenes.mjs 的 28 */
const PAD = 40;

/**
 * README 那批截图之一：真窗口截图，Mac 窗口的外框和阴影都画在图里，这里不再套框。
 * 图四周留着给阴影的边：往外撑出去，让窗口本身的左右边和这一栏对齐。
 * dark：系统是深色时换成的那一张（同样大小）；pad：这张图四周留的边，默认窗口截图的 40；
 * flush：上下留的边也往外撑（只左右对齐时，宽高比不同的两张并排，看得见的上下边会差几像素）
 */
export function Shot({ name, dark, alt, pad = PAD, flush = false, className = "", loading = "lazy", fetchPriority }) {
  const { locale } = useI18n();
  const light = readme(name, locale);
  const night = dark ? readme(dark, locale) : null;
  const inner = light.width - pad * 2;
  return (
    <picture
      className={`block ${className}`}
      style={{
        width: `calc(100% * ${light.width} / ${inner})`,
        // 外边距的百分比都按这一栏的宽算，上下也一样
        [flush ? "margin" : "marginInline"]: `calc(-100% * ${pad} / ${inner})`,
      }}
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
