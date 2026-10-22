// 悬浮条上的语音输入：开口就能说，没有要选的，成品只有一段字。接口见 index.mjs
export const dictate = Object.freeze({
  id: "dictate",
  mode: "voice_transcript",
  configMode: "transcript",
  open: () => Object.freeze({}),
  parameters: () => null,
  chip: () => null,
  pick: (state) => state,
  finishing: null,
  delivered: () => ({}),
});
