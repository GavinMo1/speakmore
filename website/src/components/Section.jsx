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

/**
 * 文案里的 \n 是标题换行的位置。muted：除了最后一行都用浅色，先铺垫、后落点（"口述随意"浅、"成文规整"深），
 * 两行一样大小时也分得出主次
 */
export function Lines({ text, muted = false }) {
  const lines = text.split("\n");
  return lines.map((line, index) => {
    const last = index === lines.length - 1;
    return (
      <span key={line} className={`block ${muted && !last ? "text-ink-2" : ""}`}>
        {line}
        {last ? null : " "}
      </span>
    );
  });
}

/**
 * 每段的大标题和一句话。
 * split（默认）：标题靠左，那句话放在右边一栏、和标题的底边对齐；窄屏上下排，都靠左。标题第一行浅、第二行深。
 * 不再是"两行大字、两行小字全部居中往下摞"：主次靠位置和深浅分开，不只靠字号
 * center：居中，给只有一行标题、没有那句话的段落（隐私与开放）
 */
export function Heading({ id, title, lead, align = "split" }) {
  if (align === "center") {
    return (
      <header className="reveal mx-auto max-w-3xl text-center">
        <h2 id={id} className="display text-[clamp(2.4rem,6vw,4.5rem)]">
          <Lines text={title} />
        </h2>
      </header>
    );
  }
  return (
    <header className="reveal grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-16">
      <h2 id={id} className="display text-[clamp(2.4rem,6vw,4.5rem)]">
        <Lines text={title} muted />
      </h2>
      {lead ? (
        // 中文只在标点和空格处换行，不把一个词拆到两行；几行尽量一样长，不剩一个短尾巴
        <p className="max-w-[30rem] text-[clamp(1.0625rem,1.6vw,1.3125rem)] leading-relaxed text-balance break-keep wrap-anywhere text-ink-2 lg:justify-self-end lg:pb-[0.3em]">
          {lead}
        </p>
      ) : null}
    </header>
  );
}
