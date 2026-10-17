// 模型页标题行右边的推荐组合。一个组合就是"切到哪种识别方式、带上那种方式的哪几项设置"，正好是模式切换收的参数
// （app/modes.mjs 的 switchMode）：启用时验 key、查本机模型、验过才写设置，都走那一条，这里不另写。
// 按我们推荐的先后排；chips 写适合哪类芯片（catalog.mjs 的 CHIPS），不写是哪类都适合。
// 每月成本不在这里写：按价目表现算（usage/estimate.mjs），价格变了跟着变。
//
// 加一个：这里加一项，文案加 presets.items.<id> 的 name、desc（中英各一份）。删一个：删这两处。
// test/models/presets.test.mjs 守着：引用的模型都在清单里、带的设置都属于那种方式、成本算得出来、文案中英都有。
// 页面上是一列下拉的选项（renderer/hub/preset-picker.mjs），几个都排得齐。

export const PRESETS = Object.freeze(
  [
    {
      id: "local-deepseek",
      mode: "local",
      settings: { transcriber: "qwen3-asr-0.6b-q8", polish: "deepseek/deepseek-flash" },
      chips: ["apple-silicon"],
    },
    {
      id: "native-gemini",
      mode: "native",
      settings: { model: "gemini/gemini-3.6-flash" },
    },
    {
      id: "bailian-cloud",
      mode: "local",
      settings: { transcriber: "bailian/qwen3-asr-flash", polish: "bailian/deepseek-v4.1-flash" },
    },
    {
      id: "private-qwen",
      mode: "private",
      settings: { privateTranscriber: "qwen3-asr-0.6b-q8" },
      chips: ["apple-silicon"],
    },
    {
      id: "local-deepseek-cpu",
      mode: "local",
      settings: { transcriber: "sensevoice-small-int8", polish: "deepseek/deepseek-flash" },
      chips: ["intel-mac"],
    },
    {
      id: "private-sensevoice-cpu",
      mode: "private",
      settings: { privateTranscriber: "sensevoice-small-int8" },
      chips: ["intel-mac"],
    },
  ].map((preset) =>
    Object.freeze({ ...preset, settings: Object.freeze(preset.settings), chips: Object.freeze(preset.chips ?? null) }),
  ),
);

/** 适合这类芯片的组合，按推荐的先后 */
export const presetsFor = (chip) => PRESETS.filter(({ chips }) => chips === null || chips.includes(chip));
