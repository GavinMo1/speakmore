---
name: typeless-clone-real-recordings-ok
description: 用户已同意用他 Typeless 的真实历史录音调仿刻的提示词，录音会发给 Gemini
metadata:
  type: project
---

可以用用户本机 Typeless 的真实历史录音来调仿刻的提示词。他 2026-10-13 的原话："我们开始使用 Typeless 的真实录音去调一下 prompt"。

**Why:** 在这之前我问过两次能不能抽历史录音发给 Gemini 做对比，他没有回答，所以提示词只用系统朗读的合成语音测过。合成语音测不出真实口音下的效果，也看不出原版的格式习惯。

**How to apply:** 录音在 `~/Library/Application Support/Typeless/Recordings/`，对应的原版成品在同目录 `typeless.db` 的 `history_v2.refined_text`，可以当参照答案。发给 Gemini 时用 [[typeless-clone-gemini-key]] 那把 key。这个同意只针对"调仿刻的提示词"这个用途；录音和成品文字是他说过的话，不进 git、不抄进文档，放 `targets/typeless/_work/`。他点名要先解决的是格式：原版会按说话内容自动换行、分点（这是他的观察，我还没有拿数据核对过）。相关：[[typeless-clone-scope-dictation]]、[[typeless-clone-as-real-product]]。
