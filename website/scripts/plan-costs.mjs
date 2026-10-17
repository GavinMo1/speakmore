// 算好费用一段的两个方案每月多少，写进 src/costs.json（在仓库根装好依赖后，在 website/ 下跑 npm run plan-costs）。
// 算法和价目都在 App 那边（src/usage/plan-costs.mjs）；价目改了重跑一次，根上的测试会提醒
import { writeFileSync } from "node:fs";
import { planCosts } from "../../src/usage/plan-costs.mjs";

const file = new URL("../src/costs.json", import.meta.url);
const costs = await planCosts();
writeFileSync(file, `${JSON.stringify(costs, null, 2)}\n`);
console.log(costs);
