/**
 * 一张主窗口的截图，套上 Mac 窗口的圆角、细边和阴影，左上角补上红黄绿三个按钮
 * （App 的窗口没有标题栏，三个按钮浮在内容上，截图里没有它们）。
 * 截图是 1080×750 的窗口：按钮在 (26, 24)，直径 12、间隔 20，这里按比例摆
 */
export function WindowFrame({ src, width, height, alt, className = "", loading = "lazy", fetchPriority }) {
  return (
    <figure
      className={`relative overflow-hidden rounded-[clamp(8px,1.2vw,14px)] bg-surface shadow-[0_0_0_1px_oklch(0_0_0/0.12),0_30px_80px_-20px_oklch(0_0_0/0.45),0_12px_24px_-12px_oklch(0_0_0/0.3)] ${className}`}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <img
        src={src}
        width={width}
        height={height}
        alt={alt}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
        className="block size-full"
      />
      <span
        className="pointer-events-none absolute flex gap-[0.7%]"
        style={{ left: `${(26 / width) * 100}%`, top: `${(24 / height) * 100}%`, width: `${(52 / width) * 100}%` }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
          <i
            key={color}
            className="block aspect-square w-[23%] rounded-full"
            style={{ background: color, boxShadow: "inset 0 0 0 0.5px oklch(0 0 0 / 0.2)" }}
          />
        ))}
      </span>
    </figure>
  );
}
