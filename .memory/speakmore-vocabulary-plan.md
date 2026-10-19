---
name: speakmore-vocabulary-plan
description: "词典功能（issue #9 引出）10-19 在 feat/vocabulary 分支上开干，链路、页面、命令行已提交，正在跑真实录音评测；剩文档、App 端到端、对抗审查、合并前问"
metadata:
  node_type: memory
  type: project
  originSessionId: 6b5e9ce5-00ff-48cc-99ba-a927306fc7c3
  modified: 2026-10-19T07:42:45.012Z
---

2026-10-19 用户说"开分支，彻底开干"，在 feat/vocabulary 上做。他的要求：
- 整条链路都支持词表：本机转写、云端转写、原生识别、润色，热词、上下文、提示词三种做法都要覆盖。
- 严格策略模式：统一接口加各模型的适配策略，改一个模型只动一小块，"不能拧成一团麻花"。
- 做完全面端到端验证，本机模型也要测完；开发 key 的额度可以用（不太过分）。
- 界面对齐 Typeless 的词典页，讲清两点：词表只存在本机、支持哪些模型。要极高审美（"不要像前端初学者"）；他嫌信息栏一行塞了内容、模型名、识别方式太挤，已改成两栏加短标签。
- 做完起一轮对抗性审查。

已提交（分支上 4 个 commit，main 上还有一个记忆 commit 755c9c0 没推）：
- 449adb1 src/vocabulary/（terms 规整导入、support 收法和挑词）+ storage/vocabulary.mjs（~/.speakmore/vocabulary.json）
- b29415b 链路：server.mjs 每次听写读一次词典交给 prepare/refine；收法写在模型清单（catalog.mjs、asr/cloud/vendors.mjs），放进请求由适配器管
- 797b623 词典页（renderer/hub/vocabulary.*、app/vocabulary.mjs、docs/PRODUCT.md）
- 5339db3 命令行 speakmore dict

实测定下的（都在代码注释里）：百炼 qwen3-asr-flash 的 system 消息 content 必须写成数组，写成字符串回 400；智谱 hotwords 每个词一个字段；sherpa-onnx 的 Qwen3 KV 只有 512 个位置，热词 400 字开始截音频，限 120 字；transcribe.cpp 版限 600 字（CPU 上多 0.3 秒）；MiniMax、SenseVoice 不收。

**Why:** 用户早就想做，issue #9 给了契机；他要的是能长期维护的结构和真实验证过的效果。

**How to apply:** 接着做：1. 读 bench/_work/vocabulary/report.md（scripts/dev/eval-vocabulary.mjs，30 条原版录音，各模型带不带词典对比，含"硬塞"计数），效果写进 bench/results/vocabulary-2026-10-19.md，必要时调上限或提示词；2. App 端到端（scripts/dev/e2e.mjs，家目录放 vocabulary.json，native、local、private 各一遍）；3. 文档：docs/development.md、README 中英；4. 一轮对抗审查；5. 合并、推送前问用户。开发窗口用 /tmp/smv 家目录、热键右 Control，驱动脚本在会话 scratchpad/ui/cdp.mjs。相关：[[speakmore-model-plaza]]、[[speakmore-two-pipelines]]、[[desktop-copy-and-look]]
