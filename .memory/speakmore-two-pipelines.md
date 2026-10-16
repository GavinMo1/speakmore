---
name: speakmore-two-pipelines
description: 识别分两种平级的模式让用户选：native（音频直接给能收音频的模型）和 local（本机小模型转写再交任意 API 润色），严格状态机；先搭内核，Windows 之后再做；本地模型不替用户选
metadata:
  node_type: memory
  type: project
  originSessionId: 6b5e9ce5-00ff-48cc-99ba-a927306fc7c3
  modified: 2026-10-16T09:17:56.939Z
---

2026-10-16 他定的方向。宣传片发出后，小红书和抖音上催更的主要是两件事：Windows 适配，以及能接更多 API。他的判断是：现在把音频直接发给大模型，只有千问、OpenAI、Gemini 收音频，没法接所有 API；所以另开一条链路，先用本地小模型转写，再把文字交给任意 API 润色。

他的原话："这两条是截然不同的路，地位必须平级、并行，谁也不能覆盖谁，优先级没有高低之分。"

**Why:** 让只有纯文字 API 的用户也能用，同时不牺牲原生链路。
**How to apply:**
- 两条链路平级，由用户在设置里选。不做"原生失败就退到本地"这类主次关系，也不把一条写成另一条的特例。
- 先搭识别内核的两条链路，Windows 外壳之后再做。他说内核搭好后，外壳适配比较简单。
- 评测在 `bench/`（说明见 bench/README.md），用实测数据来选模型；判官是 Claude 自己，见 [[bench-judge-is-claude]]。
- 第一轮评测结果（2026-10-16，97 条真实录音，共 42.5 分钟，判官是 Claude，本机是 Apple 芯片）：
  - Qwen3-ASR 0.6B Q8 走 transcribe.cpp 加 Metal 最准：均分 4.14，每条 p50 231 ms、p90 731 ms，内存 2.0 GB。同一个文件只用 CPU 时一样准，但 p50 1.06 s、p90 3.5 s，内存 4.5 GB。
  - SenseVoice Q8 加 Metal 最快：均分 3.94，p50 73 ms，内存 1.2 GB。纯中文和 Qwen3 差不多，弱在英文词（中英夹杂 3.51 对 4.02）。
  - sherpa-onnx 的 Qwen3 int8 有两个坑：导出时 KV 缓存定死 512，要按 20 秒分段；有一段输入会输出乱码。
  - 原生链路（Gemini 一步到成品）整条 p50 4.0 s。
  - 他室友说"0.6B 很慢"：只用 CPU 时确实慢，用 Metal 后快 4 到 5 倍。
- 2026-10-16 实现成两种"模式"（设置项 `mode`：`native` / `local`），按用户要求分层、严格状态机：模型只能在它那种模式里换（`speakmore model` 只管 native；`transcriber`、`polish` 只管 local 的两跳），不在那种模式里换就报错；切模式可以连带那种模式自己的设置。内核在 `src/app/modes.mjs`，App 设置页和命令行都走它。
- `speakmore config set` 不经过状态机：2026-10-16 用户同意按我的建议留作手动改设置的后门，只在改模式管的几项时提示平时用哪个命令、写的是另一种模式的设置时说切过去才用上。别再把它收进状态机。
- 端到端（[[speakmore-model-mirror]] 里也记了下载速度）：local 模式 Qwen3 Q8 + DeepSeek flash，松开到出字 1.2–1.75 s，转写不到 0.7 s，大头是润色请求。记录在 `bench/results/e2e-local-2026-10-16.md`。
- 2026-10-16 用户在自己电脑上用 local（Qwen3-ASR Q8 + DeepSeek flash）实际听写后说："效果比原生 Gemini 的还好，这个是让我比较震惊的一个事"。两种模式仍然平级，不因此把 local 设成默认；但写宣传、README 时可以引用这条真实反馈。
- 0.7.1（2026-10-16 已发）：本机模型由用户点了才下；每个模型（原生、润色、本机）都能"检查"，本机的是用系统朗读念一句交给它转；用量按模型分开，本机转写那一跳也记一笔（provider 是 local，不花钱）。
- 不替用户选模型，做成模型广场、按实测打标签，见 [[speakmore-model-plaza]]。
- 本地模型的调研（2026-10-16）：首选 Qwen3-ASR-0.6B（Apache-2.0，Q8 约 0.8 GB，FLEURS 普通话 CER 7.57%）；轻量备选 SenseVoice-Small（约 0.24 GB，CER 10.12%，许可证是 FunASR 自定义的）。运行库可选 sherpa-onnx-node（Apache-2.0）或 transcribe-cpp（MIT），两者在 npm 上都有 Mac 两种芯片和 Windows 的预编译包。榜单是朗读语音，中英夹杂的口述没有公开数字，要用真录音实测。

相关：[[speakmore-model-providers]]、[[typeless-clone-open-source-panel]]、[[typeless-clone-scope-dictation]]。
