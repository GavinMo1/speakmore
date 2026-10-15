/** 一颗 Mac 键盘上的键：浅色的键帽，底下一道阴影当厚度 */
export function Keycap({ children, size = "md" }) {
  const sizes = {
    sm: "h-7 min-w-7 px-2 text-xs rounded-md",
    md: "h-12 min-w-12 px-3.5 text-[0.95rem] rounded-[10px]",
    lg: "h-16 min-w-16 px-5 text-lg rounded-xl",
  };
  return (
    <kbd
      className={`inline-flex items-center justify-center font-sans font-semibold whitespace-nowrap ${sizes[size]} bg-linear-to-b from-raised to-surface text-ink shadow-[0_1px_0_1px_var(--color-line),0_3px_0_1px_oklch(0_0_0/0.12),0_8px_18px_-6px_oklch(0_0_0/0.25)]`}
    >
      {children}
    </kbd>
  );
}
