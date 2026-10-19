import { placementOf } from "./placement.mjs";

// transcribe.cpp（Handy 的引擎，MIT，基于 ggml）的适配器：读 GGUF，Apple 芯片上自动走 Metal，Windows 走 Vulkan，
// 别处退回 CPU；npm 上有 Mac 两种芯片（Intel 只有 CPU）、Windows、Linux 的预编译包。接口见 index.mjs。

/**
 * 认得的模型族。每一族都是一个 GGUF 文件，清单里叫 gguf；输出是干净的文字，没有要去掉的标记。
 * vocabulary：收用户词典的族才写，按做法（清单里模型声明的 kind）查：挑好的词怎么并进 run 的参数
 * （运行库按族排进提示词，超出预算的从后往前丢）
 */
const singleGguf = (file) => file("gguf");

export const FAMILIES = Object.freeze({
  "qwen3-asr": Object.freeze({
    config: singleGguf,
    vocabulary: Object.freeze({ hotwords: (terms) => ({ vocabulary: terms }) }),
  }),
  "sense-voice": Object.freeze({ config: singleGguf }),
});

/**
 * 预热用的声音：1.5 秒，两个音叠起来再加一点噪声（全静音的话运行库什么都不算，热不起来）。
 * 在显卡上跑时，第一次转写要先把显卡上的程序编出来：Windows 的 Vulkan 第一次要七八秒（2026-10-17 在 RTX 4060 Ti 上实测
 * 6.8 秒），之后驱动按可执行文件把编好的缓存在磁盘上，再起来就快了。装上模型时先拿它转一遍，这段时间花在启动时的后台，
 * 不落在第一次听写上。它转不出字，所以只热得了大半（解码那部分第一次仍要多两三秒），缓存有了之后预热本身几十毫秒
 */
const WARMUP_SECONDS = 1.5;
const warmupSamples = () => {
  const rate = 16_000;
  return Float32Array.from(
    { length: rate * WARMUP_SECONDS },
    (_, i) =>
      0.1 * Math.sin((2 * Math.PI * 220 * i) / rate) +
      0.05 * Math.sin((2 * Math.PI * 523 * i) / rate) +
      0.02 * (((i * 7919) % 101) / 101 - 0.5),
  );
};

/** 跑在 CPU 上不用预热：没有要编的东西 */
const onGpu = (backend) => !/^cpu$/i.test(String(backend ?? ""));

export async function version() {
  const { version } = await import("transcribe-cpp");
  return version().version;
}

/**
 * @param {{ model: object, file: (role: string) => string, options?: { backend?: string, threads?: number } }} request
 *   backend：auto（默认，有 GPU 用 GPU）、cpu、metal、vulkan…；threads：CPU 那部分用几个线程，不给是库的默认值
 * @param {{ runtime?: () => Promise<{ TranscribeModel: object }> }} [deps] 测试时换掉运行库
 * @returns {Promise<{ backend: string, warmupMs: number | null, transcribe: Function, dispose: Function }>}
 *   warmupMs：在显卡上时预热花了多久，CPU 上是 null
 */
export async function load({ model, file, options = {} }, { runtime = () => import("transcribe-cpp") } = {}) {
  const { TranscribeModel } = await runtime();
  const family = FAMILIES[model.family];
  const place = placementOf(model, family, "transcribe.cpp");
  const loaded = await TranscribeModel.load(family.config(file), {
    backend: options.backend ?? "auto",
  });
  const session = loaded.createSession({ nThreads: options.threads ?? 0 });
  let warmupMs = null;
  if (onGpu(loaded.backend)) {
    const startedAt = performance.now();
    await session.run(warmupSamples(), { timestamps: "none" });
    warmupMs = Math.round(performance.now() - startedAt);
  }
  return {
    backend: loaded.backend,
    warmupMs,
    /** @param {{ vocabulary?: readonly string[] }} [options] 挑好的词（index.mjs 的 windowed） */
    async transcribe(samples, { vocabulary = [] } = {}) {
      // 只要文字，不要时间戳：时间戳要多算一遍对齐
      const words = place && vocabulary.length > 0 ? place(vocabulary) : {};
      const result = await session.run(samples, { timestamps: "none", ...words });
      return { text: String(result.text ?? "").trim() };
    },
    dispose() {
      session.dispose();
      loaded.dispose();
    },
  };
}
