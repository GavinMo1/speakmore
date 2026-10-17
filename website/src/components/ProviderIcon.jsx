import { PROVIDER_ICON_PATHS } from "../../../src/renderer/shared/provider-icons.mjs";

/** 一家模型的标志：单色、跟着字的颜色走，和 App 里用的是同一份（src/renderer/shared/provider-icons.mjs） */
export function ProviderIcon({ id, className = "size-6" }) {
  const d = PROVIDER_ICON_PATHS[id];
  if (!d) throw new Error(`没有 ${id} 的标志：在 src/renderer/shared/provider-icons.mjs 里`);
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false" fill="currentColor">
      {(typeof d === "string" ? [{ d }] : d).map((layer) => (
        <path key={layer.d} d={layer.d} fillOpacity={layer.opacity} fillRule={layer.rule} />
      ))}
    </svg>
  );
}
