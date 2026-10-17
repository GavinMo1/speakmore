// 数字滚到哪一格由外面那一块的 data-roll 管（lib/usePageMotion.js 的 useEnterOnce），这里只画。
// 每一位数字是一条 0–9 走两遍的竖条，最后停在第二遍的那个数上：0 也会滚一圈，几位一起转才像计数器
const STRIP = [..."01234567890123456789"];

/** 一个数：读屏读整串；画面上每位数字是一条会滚的竖条（styles.css 的 .roll），别的字符原样 */
export function Rolling({ value }) {
  return (
    <>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="inline-flex">
        {[...value].map((char, place) =>
          /\d/.test(char) ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: 字符的位置是固定的
            <span key={place} className="roll" style={{ "--d": 10 + Number(char), "--p": place }}>
              {/* 撑出这一位最后那个数本来的宽度：1 窄、0 宽，不留空 */}
              <span className="invisible">{char}</span>
              <span className="roll-strip">
                {STRIP.map((digit, row) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 竖条是固定的两遍 0–9
                  <span key={row}>{digit}</span>
                ))}
              </span>
            </span>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: 字符的位置是固定的
            <span key={place}>{char}</span>
          ),
        )}
      </span>
    </>
  );
}
