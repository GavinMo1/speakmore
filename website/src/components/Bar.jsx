/**
 * 说话时屏幕底部的那条悬浮条，照 App 里的样子（src/renderer/bar/bar.css）用朱砂主题的颜色画出来，会动。
 * state：recording（声波跟着说话起伏）、finishing（整理中，一道匀速滚过的波）、done（打一个勾）
 */
const SURFACE = "oklch(0.17 0.008 32)";
const EDGE = "oklch(0.34 0.012 32)";
const GHOST = "oklch(0.32 0.014 32)";
const LIVE = "oklch(0.74 0.17 32)";

// 每根竖条说话时最高到多高：中间高、两头低
const PEAKS = [0.3, 0.42, 0.55, 0.7, 0.82, 0.92, 1, 0.95, 1, 0.9, 0.8, 0.66, 0.52, 0.4, 0.28];

export function Bar({ state = "recording", hint, className = "" }) {
  const recording = state === "recording";
  return (
    <div className={`flex flex-col items-center gap-1.5 ${className}`} aria-hidden="true">
      {hint ? (
        <p
          className="rounded-full px-2.5 py-0.5 text-[11px] leading-normal whitespace-nowrap text-[oklch(0.75_0.012_32)]"
          style={{ background: SURFACE, boxShadow: `0 0 0 1px ${EDGE}` }}
        >
          {hint}
        </p>
      ) : null}
      <div
        className="flex h-10 items-center gap-2 rounded-[20px] p-1.5"
        style={{
          background: SURFACE,
          boxShadow: `0 0 0 1px ${EDGE}, 0 6px 18px oklch(0 0 0 / 0.3), 0 2px 5px oklch(0 0 0 / 0.2)`,
        }}
      >
        <span
          className="grid size-7 place-items-center rounded-full text-[oklch(0.97_0.004_32)] transition-[opacity,transform] duration-200 ease-out-quint"
          style={{ background: GHOST, opacity: recording ? 1 : 0, transform: recording ? "none" : "scale(0.6)" }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 14 14"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </span>

        <span className="relative h-[22px] w-[76px]">
          {/* 声波 */}
          <span
            className="absolute inset-0 flex items-center justify-center gap-[2px] transition-opacity duration-200"
            style={{ opacity: recording ? 1 : 0 }}
          >
            {PEAKS.map((peak, index) => (
              <i
                // biome-ignore lint/suspicious/noArrayIndexKey: 竖条的个数和顺序是固定的
                key={index}
                className="block h-full w-[2px] rounded-[1px] motion-safe:animate-[talk_1.1s_ease-in-out_infinite]"
                style={{
                  background: LIVE,
                  transform: `scaleY(${peak * 0.6})`,
                  // 离中间越远起得越晚，看起来是从中间往两边传开
                  animationDelay: `${Math.abs(index - 7) * 70}ms`,
                  animationDuration: `${900 + (index % 4) * 120}ms`,
                  scale: `1 ${peak}`,
                }}
              />
            ))}
          </span>
          {/* 整理中 */}
          <span
            className="absolute inset-0 flex items-center justify-center gap-[3px] transition-opacity duration-200"
            style={{ opacity: state === "finishing" ? 1 : 0 }}
          >
            {Array.from({ length: 9 }, (_, index) => (
              <i
                // biome-ignore lint/suspicious/noArrayIndexKey: 竖条的个数和顺序是固定的
                key={index}
                className="block h-full w-[3px] rounded-[2px] motion-safe:animate-[think_1.15s_ease-in-out_infinite]"
                style={{ background: LIVE, transform: "scaleY(0.2)", animationDelay: `${index * -90}ms` }}
              />
            ))}
          </span>
          {/* 完成 */}
          <svg
            aria-hidden="true"
            viewBox="0 0 76 22"
            className="absolute inset-0 transition-opacity duration-200"
            style={{ opacity: state === "done" ? 1 : 0 }}
          >
            <path
              key={state}
              d="M30 11.5l5.5 5.5L47 5.5"
              fill="none"
              stroke={LIVE}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="24"
              strokeDashoffset={state === "done" ? 24 : 0}
              className={
                state === "done"
                  ? "motion-safe:animate-[draw_380ms_var(--ease-out-quint)_forwards] motion-reduce:[stroke-dashoffset:0]"
                  : ""
              }
            />
          </svg>
        </span>

        <span
          className="grid size-7 place-items-center rounded-full transition-[opacity,transform] duration-200 ease-out-quint"
          style={{
            background: LIVE,
            color: SURFACE,
            opacity: recording ? 1 : 0,
            transform: recording ? "none" : "scale(0.6)",
          }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 14 14"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 7.5l3 3 6-7" />
          </svg>
        </span>
      </div>
    </div>
  );
}
