// 云端转写的清单：本地转写链路（local 模式）的第一跳除了本机模型，也可以交给云端的语音识别模型。
// 和本机的运行库（../engines）是同一个位置上的两种策略，上面的人只认 transcribe(samples) → { text }。
// 每家一个适配器（同目录下的 bailian.mjs、zhipu.mjs、minimax.mjs），各自管请求怎么拼、回话怎么拆、报错怎么认；
// 录音统一成 16 kHz 单声道（transcriber.mjs 编成 wav 再交给适配器），适配器不用管格式。
// 一次吃不下的长录音：模型项写上 maxSeconds（一段最多几秒），transcriber.mjs 照本机模型的规矩切开（../segment.mjs），
// 适配器只管一段。
//
// 只收同步的接口：一次请求交一整段录音、回一整段原文。要先上传文件再轮询的（百炼的 filetrans、fun-asr、
// paraformer-v2）和走 WebSocket 的实时识别都不收：听写说完就要出字，等不起轮询，也不必为一整段录音开流。
//
// 这里只放说明，不加载适配器：命令行列模型时也要读这份清单。加一家 = 写一个适配器、在下面登记一项。
// 设置里的写法是 厂商/模型（bailian/qwen3-asr-flash），和本机模型的 id（不带斜杠）区分开。

export const CLOUD_TRANSCRIBERS = Object.freeze([
  Object.freeze({
    id: "bailian",
    // 界面上按语言写成"阿里云百炼"或"Alibaba Cloud Bailian"（文案 providers.bailian.name），这里的名字给日志和报错用
    name: "Bailian",
    keyEnv: "BAILIAN_API_KEY",
    keyPage: "https://bailian.console.aliyun.com/?tab=model#/api-key",
    defaultModel: "qwen3-asr-flash",
    // 2026-10-16 拿一段 23 秒、一段 55 秒的录音逐个实测过：都是一次请求回整段，1.5–1.8 秒。
    // wire 是走哪套接口（适配器按它拼请求）：chat 是 OpenAI 兼容的 Chat Completions，dashscope 是百炼自己的
    // multimodal-generation。qwen-audio、fun-asr 在兼容接口上回 404 或 400 "format is empty"，只能走后者
    models: Object.freeze(
      [
        { id: "qwen3-asr-flash", name: "Qwen3 ASR Flash", wire: "chat" },
        { id: "qwen-audio-3.1-asr-flash", name: "Qwen Audio 3.1 ASR Flash", wire: "dashscope" },
        { id: "qwen-audio-3.0-asr-flash", name: "Qwen Audio 3.0 ASR Flash", wire: "dashscope" },
        { id: "fun-asr-flash-2026-06-15", name: "Fun-ASR Flash", wire: "dashscope" },
      ].map((model) => Object.freeze({ ...model, maker: "qwen" })),
    ),
    load: () => import("./bailian.mjs"),
    // costOf 记账（适配器用），listPrice 给模型广场标每小时的价
    prices: () => import("./prices/bailian.mjs"),
  }),
  Object.freeze({
    id: "zhipu",
    // 界面上按语言写成"智谱"或"Zhipu GLM"（文案 providers.zhipu.name），这里的名字给日志和报错用
    name: "Zhipu",
    keyEnv: "ZHIPU_API_KEY",
    keyPage: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    defaultModel: "glm-asr-2512",
    // 照官方文档写，未拿真 key 验证（zhipu.mjs）。文档写的是一段不超过 30 秒，切的时候留一秒余量，免得卡在边上被拒
    models: Object.freeze([
      Object.freeze({ id: "glm-asr-2512", name: "GLM-ASR-2512", maker: "zhipu", maxSeconds: 29, unverified: true }),
    ]),
    load: () => import("./zhipu.mjs"),
    prices: () => import("./prices/zhipu.mjs"),
  }),
  Object.freeze({
    id: "minimax",
    name: "MiniMax",
    keyEnv: "MINIMAX_API_KEY",
    keyPage: "https://platform.minimax.cn/user-center/basic-information/interface-key",
    defaultModel: "asr-1.0",
    // 2026-10-16 拿真 key 实测过（minimax.mjs）。文档写的是一段不超过 500 秒、超了回 400 不截断
    models: Object.freeze([
      Object.freeze({ id: "asr-1.0", name: "MiniMax ASR 1.0", maker: "minimax", maxSeconds: 500 }),
    ]),
    load: () => import("./minimax.mjs"),
    prices: () => import("./prices/minimax.mjs"),
  }),
]);

/** @returns {(typeof CLOUD_TRANSCRIBERS)[number] | null} 大小写不论；不认识的是 null */
export function findCloudTranscriber(id) {
  const wanted = String(id).toLowerCase();
  return CLOUD_TRANSCRIBERS.find((vendor) => vendor.id === wanted) ?? null;
}

/**
 * 设置里写的第一跳 → 云端的 { vendor, model }；写的是本机模型（不带斜杠）时是 null。
 * 只写厂商（bailian）用它的默认模型。厂商不认识时也是 null，由调用方按本机模型的规矩报错
 * @param {string} value
 * @returns {{ vendor: string, model: string } | null}
 */
export function cloudTranscriberOf(value) {
  const text = String(value ?? "").trim();
  const slash = text.indexOf("/");
  const vendor = findCloudTranscriber(slash === -1 ? text : text.slice(0, slash));
  if (!vendor) return null;
  const model = slash === -1 ? vendor.defaultModel : text.slice(slash + 1);
  return model ? { vendor: vendor.id, model } : null;
}

/** 某个云端模型在清单里的那一项；清单外的是 null（照样能发，按这一家的默认接口） */
export const cloudModelOf = (vendor, model) => vendor.models.find(({ id }) => id === model) ?? null;
