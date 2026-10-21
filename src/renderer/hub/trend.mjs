// 花费卡柱子上那条淡的趋势线：柱子一多（累计按天七十来根）就看不出走势，叠一条平滑过的线，一眼看出大概的起伏。
// 平滑用高斯核：每一格换成它附近几格的加权平均，离得越远分量越小；两头附近的格子少，按实际有的分量归一，线不会在两头往下掉。
// 再用单调的三次曲线把各点连起来（Fritsch–Carlson）：过每一个点，每一段只在两头之间走，不冲过头，不会画到 0 以下。
// 纯计算，不碰页面。

/**
 * 平滑的宽窄（高斯核的标准差，按格子算）：格子总数的 1/32，至少 0.75 格。按天排满一个月是 1 格左右，累计七十来天是 2 格多。
 * 起先是 1/16，他嫌太保守、几乎看不出起伏：那时本月的线起伏只有最高那根柱子的两成，收窄后六成上下
 */
export const spreadFor = (count) => Math.max(0.75, count / 32);

/**
 * @param {number[]} values 每一格的数
 * @param {number} spread 平滑的宽窄，格子数
 * @returns {number[]} 平滑后的每一格，个数不变
 */
export function smoothed(values, spread) {
  // 三个标准差以外的分量小到可以不算
  const reach = Math.ceil(spread * 3);
  return values.map((_, index) => {
    let sum = 0;
    let weight = 0;
    for (let other = Math.max(0, index - reach); other <= Math.min(values.length - 1, index + reach); other++) {
      const share = Math.exp(-((other - index) ** 2) / (2 * spread ** 2));
      sum += share * values[other];
      weight += share;
    }
    return sum / weight;
  });
}

const fixed = (number) => Number(number.toFixed(3));

/**
 * 过这些点的平滑曲线，写成 SVG path 的 d：单调三次 Hermite 插值，每一段换成一段三次贝塞尔。
 * @param {[number, number][]} points x 从小到大
 */
export function curvePath(points) {
  if (points.length === 0) return "";
  const start = `M${fixed(points[0][0])},${fixed(points[0][1])}`;
  if (points.length === 1) return start;

  const last = points.length - 1;
  const widths = [];
  const slopes = [];
  for (let index = 0; index < last; index++) {
    widths.push(points[index + 1][0] - points[index][0]);
    slopes.push((points[index + 1][1] - points[index][1]) / widths[index]);
  }
  // 每个点的切线：两边斜率的平均；是山顶、谷底（两边一升一降）的地方放平
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === last) return slopes[last - 1];
    return slopes[index - 1] * slopes[index] <= 0 ? 0 : (slopes[index - 1] + slopes[index]) / 2;
  });
  // Fritsch–Carlson：平的那一段两头的切线放平；切线太陡会冲过头，按比例收回来
  for (let index = 0; index < last; index++) {
    if (slopes[index] === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const before = tangents[index] / slopes[index];
    const after = tangents[index + 1] / slopes[index];
    const length = before ** 2 + after ** 2;
    if (length > 9) {
      const scale = 3 / Math.sqrt(length);
      tangents[index] = scale * before * slopes[index];
      tangents[index + 1] = scale * after * slopes[index];
    }
  }

  let path = start;
  for (let index = 0; index < last; index++) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    const third = widths[index] / 3;
    path +=
      `C${fixed(x0 + third)},${fixed(y0 + tangents[index] * third)} ` +
      `${fixed(x1 - third)},${fixed(y1 - tangents[index + 1] * third)} ${fixed(x1)},${fixed(y1)}`;
  }
  return path;
}
