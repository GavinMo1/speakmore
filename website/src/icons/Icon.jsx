import { icons } from "./data.js";

/**
 * 一个图标。默认只是装饰（读屏跳过）；给了 label 才读出来。
 * SVG 的内容是 scripts/icons.mjs 从 Iconify 取下来的固定字符串，不来自访客输入
 */
export function Icon({ name, label, className = "size-5", ...rest }) {
  const icon = icons[name];
  if (!icon) throw new Error(`没有这个图标：${name}（在 scripts/icons.mjs 里登记再跑 npm run icons）`);
  return (
    <svg
      viewBox={`${icon.left ?? 0} ${icon.top ?? 0} ${icon.width} ${icon.height}`}
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: 图标是构建时生成的固定内容
      dangerouslySetInnerHTML={{ __html: icon.body }}
      {...rest}
    />
  );
}
