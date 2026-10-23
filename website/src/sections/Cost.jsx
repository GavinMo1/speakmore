import { Rolling } from "../components/Rolling.jsx";
import { costs } from "../config.js";
import { useI18n } from "../i18n/index.jsx";
import { useEnterOnce } from "../lib/usePageMotion.js";

/** 中文写人民币，英文写美元；到分，不花钱的写 0（和 App 模型页推荐组合的写法一样） */
function price(plan, locale) {
  const [symbol, value] = locale === "zh-CN" ? ["¥", plan.cny] : ["$", plan.usd];
  return { symbol, value: value === 0 ? "0" : value.toFixed(2) };
}

/**
 * 费用：模型一段末尾的一条，不单独成段。先说软件免费、没有订阅，钱直接付给模型厂商，免得看成在卖套餐；
 * 右边两个数只是例子：混合方式每天 100 次语音输入每月多少，离线不花钱（模型下到本机，自己电脑上跑 AI）。
 * 月成本和 App 同一套算法（src/costs.json），滚到时数字转到位。id 留着 cost，旧的 #cost 链接还能跳过来
 */
export function Cost() {
  const { m, locale } = useI18n();
  const roll = useEnterOnce("-8%");
  const plans = [
    { id: "paid", text: m.cost.paid, cost: price(costs.paid, locale) },
    { id: "free", text: m.cost.free, cost: price(costs.free, locale) },
  ];
  return (
    <div
      id="cost"
      className="reveal mt-[clamp(4rem,9vw,7rem)] grid scroll-mt-24 gap-x-16 gap-y-10 border-t border-line pt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      <div>
        <h3 className="text-[clamp(1.5rem,2.6vw,2rem)] font-semibold tracking-[-0.02em] text-balance text-ink">
          {m.cost.title}
        </h3>
        <p className="mt-2 text-[1.0625rem] text-ink-2">{m.cost.text}</p>
      </div>
      <dl ref={roll.ref} data-roll={roll.stage} className="grid grid-cols-2 gap-x-8 sm:gap-x-12">
        {plans.map(({ id, text, cost }) => (
          // 名字、数、一句话；dt 得写在前面，名字本来就在最上面
          <div key={id}>
            <dt className="font-semibold text-ink">{text.name}</dt>
            <dd className="mt-2 font-rounded text-[clamp(2.5rem,5vw,3.5rem)] leading-[1.25] font-semibold tracking-[-0.025em] whitespace-nowrap text-ink">
              <span className="mr-0.5 text-[0.55em] font-medium text-ink-2">{cost.symbol}</span>
              <Rolling value={cost.value} />
              <span className="ml-1.5 text-[0.36em] font-medium tracking-normal text-ink-2">{m.cost.per}</span>
            </dd>
            <dd className="mt-1 text-[0.9375rem] leading-snug text-balance break-keep text-ink-2">{text.note}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
