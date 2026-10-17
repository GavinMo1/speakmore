// 记账统一记美元（用量里的 costUsd）：Gemini、OpenAI、DeepSeek 官方都按美元标价。
// 国内平台（阿里云百炼）按人民币标价，算出来的钱按这个汇率换成美元再记。
// 汇率是约数：取 2026-09-09 的中间价 6.708（currencybeacon.com 的 USD/CNY 页），记账只求量级对，不按天跟。
// 差得多了改这里，并更新上面的日期。
export const CNY_PER_USD = 6.71;

export const cnyToUsd = (cny) => cny / CNY_PER_USD;
