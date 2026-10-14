---
name: speakmore-model-providers
description: SpeakMore 接哪家模型由用户点名；DeepSeek 因不收音频已放弃，OpenAI 已接（默认 gpt-audio-mini），通义 Qwen-Omni 是查过的候选
metadata:
  type: project
---

SpeakMore 的模型层是策略：每家一个适配器（`src/server/providers/`），整理流程各家共用。接哪家由用户点名，他 2026-10-13 的原话："我说要加哪个厂商你再加，不要加我没提过的。"

**Why:** 同一天他先点了 DeepSeek。我查官方文档：DeepSeek 的对话接口只收文字、图片和文件（文件也只认图片），没有音频输入，也没有语音识别接口。他说"不支持音频的话就不考虑它了"，让我搜能收音频的。查到官方写明能"音频加提示词一次出成品"的有 OpenAI（gpt-audio 系列）和阿里通义（Qwen-Omni，有美国区，收 WAV、MP3、AAC 等，不收 Ogg/WebM）；他选了先接 OpenAI，因为他本机有一把实验用的 OpenAI key。

**How to apply:**
- 不主动加新厂商。他提到某家时，先查官方文档确认它能不能收音频、收哪些格式，再动手；只能转写不能整理的要说清会变成两步、多一截延迟。
- 再提通义时，适配器可以照 OpenAI 的写（请求格式几乎一样），但它的地址按地区和工作空间变，要先问他用哪个地区。
- OpenAI 默认用 gpt-audio-mini：同 6 段录音实测，gpt-audio-1.5 会把成品包成 JSON、偶尔回 500 "invalid content"。数字在 `docs/implementation-notes.md` 的"不止一家模型"。

相关：[[typeless-clone-gemini-key]]、[[typeless-clone-real-recordings-ok]]、[[typeless-clone-scope-dictation]]。
