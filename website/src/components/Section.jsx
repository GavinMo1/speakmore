/**
 * 一整段：底色、上下留白、内容的最大宽度。
 * tone：canvas（跟着系统深浅）、surface（跟着系统、比底色深一点）、ink（近黑，固定深色）
 * 超出的部分用 overflow: clip 裁掉，不用 hidden：hidden 会让这一段自己成了滚动容器，
 * 里面跟着滚动走的动画（.reveal、成本的数字）就去跟这个不会滚的盒子走，一直停在终点
 */
const TONES = {
  canvas: "bg-canvas",
  surface: "bg-surface",
  ink: "tone-ink",
};

export function Section({ id, tone = "canvas", className = "", children, labelledBy }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`${TONES[tone]} text-ink overflow-clip ${className}`}>
      <div className="mx-auto max-w-6xl px-5 py-[clamp(5.5rem,13vw,10rem)] sm:px-8">{children}</div>
    </section>
  );
}

/** 文案里的 \n 是标题换行的位置 */
export function Lines({ text }) {
  const lines = text.split("\n");
  return lines.map((line, index) => (
    <span key={line} className="block">
      {line}
      {index < lines.length - 1 ? " " : null}
    </span>
  ));
}

/** 每段的大标题和下面一句话。align：center 或 left */
export function Heading({ id, title, lead, align = "center", className = "" }) {
  const centered = align === "center";
  return (
    <header className={`reveal ${centered ? "mx-auto text-center" : ""} max-w-3xl ${className}`}>
      <h2 id={id} className="display text-[clamp(2.4rem,6vw,4.5rem)]">
        <Lines text={title} />
      </h2>
      {lead ? (
        <p
          className={`mt-5 text-[clamp(1.0625rem,1.8vw,1.375rem)] leading-relaxed font-medium text-ink-2 ${centered ? "mx-auto text-balance" : "text-pretty"} max-w-[36rem]`}
        >
          {lead}
        </p>
      ) : null}
    </header>
  );
}
