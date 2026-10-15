import { createContext } from "react";

// 单独一个文件：改文案（en.js、zh-CN.js）时热更新只重跑 index.jsx，这个 context 还是原来那一个，
// 页面不会因为新旧两个 context 对不上而报"要在 I18nProvider 里面用"
export const I18nContext = createContext(null);
