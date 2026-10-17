import { CLOUD_TRANSCRIBERS } from "./asr/cloud/vendors.mjs";
import { CHAT_VENDORS } from "./chat/vendors.mjs";
import { PROVIDERS } from "./providers/index.mjs";

// 用户要给 key 的每一家：原生链路收音频的那几家（providers/）、润色那一跳的纯文字模型（chat/vendors.mjs）、
// 本地转写链路第一跳的云端转写（asr/cloud/vendors.mjs）。key 按家存（storage/paths.mjs 的 keyFile），
// 同一家在几个角色里都用得上时共用一把（百炼三个角色都有，用户只配一把）。
// 这里只要存 key、找 key 用到的几样：id、名字、环境变量、去哪申请。

export const VENDORS = Object.freeze(
  [...PROVIDERS, ...CHAT_VENDORS, ...CLOUD_TRANSCRIBERS]
    .filter((vendor, index, all) => all.findIndex(({ id }) => id === vendor.id) === index)
    .map(({ id, name, keyEnv, keyPage }) => Object.freeze({ id, name, keyEnv, keyPage })),
);

/** @returns {(typeof VENDORS)[number] | null} 大小写不论；不认识的是 null */
export function findVendor(id) {
  const wanted = String(id).toLowerCase();
  return VENDORS.find((vendor) => vendor.id === wanted) ?? null;
}
