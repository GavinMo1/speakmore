import { LogoLoop } from "../components/LogoLoop.jsx";
import { Heading, Section } from "../components/Section.jsx";
import { Shot } from "../components/Shot.jsx";
import { useI18n } from "../i18n/index.jsx";
import { Cost } from "./Cost.jsx";

/** 轮播里的各家，按这个顺序走；名字在文案里（models.vendors） */
const VENDORS = [
  "gemini",
  "openai",
  "qwen",
  "bailian",
  "deepseek",
  "kimi",
  "zhipu",
  "minimax",
  "funaudiollm",
  "custom",
];

/** 模型自由：一排各家的标志从页面一头走到另一头；下面是模型页的截图，旁边三句要点；最后一条是费用（钱直接付给模型厂商） */
export function Models() {
  const { m } = useI18n();
  const items = VENDORS.map((id) => ({ id, name: m.models.vendors[id] }));
  return (
    <Section id="models" labelledBy="models-title">
      <Heading id="models-title" title={m.models.title} />

      {/* 标志那一排撑满整个页面宽：从屏幕边上走进来、走出去 */}
      <div className="reveal mx-[calc(50%-50vw)] mt-[clamp(3.5rem,8vw,6rem)]">
        <LogoLoop items={items} label={m.models.loopLabel} />
      </div>

      <div className="mt-[clamp(4rem,9vw,7rem)] grid items-center gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:gap-16">
        <Shot name="polish" alt={m.models.shotAlt} className="reveal" />
        <ul className="reveal divide-y divide-line border-y border-line">
          {m.models.points.map((point) => (
            <li key={point.title} className="py-6">
              <h3 className="text-lg font-semibold text-ink">{point.title}</h3>
              <p className="mt-1.5 text-ink-2">{point.text}</p>
            </li>
          ))}
        </ul>
      </div>

      <Cost />
    </Section>
  );
}
