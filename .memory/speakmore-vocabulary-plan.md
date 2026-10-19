---
name: speakmore-vocabulary-plan
description: 词典功能（issue #9 提的行业词库）10-19 开始讨论；收录的本地模型里只有 Qwen3-ASR 收词表，原版有个人词典和按修改自动加词
metadata:
  type: project
---

2026-10-19 回复了 issue #9（行业词库、行业小模型、内网处理）：词库可以做，已排进计划。用户的原话是"并不着急直接开干，手头还有活没干完呢"，等用户点名再开工。行业小模型不做。内网就答成现有的数据隐私方式搭配词库，回复里不提润色（"都内网了、连不了网，那肯定就是本地模型"）。

2026-10-19 实测：收录的 4 个本地模型里只有 Qwen3-ASR 的两份能收词表。
- transcribe.cpp 的 GGUF 版：`supports("vocabulary")`、`supports("context_prompt")` 都是 true，运行时选项是 `vocabulary`、`prompt`。
- sherpa-onnx 的 int8 版：配置里有 `qwen3Asr.hotwords`，库把热词作为文字放在提示开头、音频之前。现在传的是空串（`src/server/asr/engines/sherpa-onnx.mjs`）。
- SenseVoice 两份都不支持。加了词表能准多少还没测。

2026-10-19 发完 0.9.4 后，用户说要开始讨论词典功能："这个其实我早就想做了，但之前一直没有契机……这回既然有人提了，咱们就顺手接过来吧"。

原版（Typeless）的做法见逆向笔记：主界面有词典页，接口 `/user/dictionary/{list,add,update,delete,batch-delete,bulk-import,bulk-import/preview}`，能从 CSV 导入（targets/typeless/docs/05-network-protocol.md、03-process-architecture.md）；贴字后约 15 秒内盯着输入框，把用户的手动修改发到 `/user/traits`，服务端可能据此自动加词，回包带 `auto_add_dictionary` 时弹"已自动加入词典"（06-context-capture-and-privacy.md）。服务端怎么用词典影响结果没查清（91-open-questions.md Q26）。

**Why:** 用户要对外说清楚：是我们收录的模型里只有它能做，不是天下只有它；有更好的模型欢迎推荐，可以再加。

**How to apply:** 开工时先拿带行业词的录音，对比加词表和不加的结果再定方案。词表还可以进润色提示词（native、local 两种方式）。回复 #9 的进展时照这个口径。相关：[[speakmore-model-plaza]]、[[speakmore-two-pipelines]]
