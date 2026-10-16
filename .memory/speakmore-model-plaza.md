---
name: speakmore-model-plaza
description: 模型广场有什么加什么、尽量全，不替用户挑模型；评测结果打成标签、配简介，让用户按自己的机器选
metadata:
  node_type: memory
  type: project
  originSessionId: 6b5e9ce5-00ff-48cc-99ba-a927306fc7c3
  modified: 2026-10-16T11:39:17.107Z
---

2026-10-16 他定的。本地转写的模型广场不替用户做决定，能接的模型都接上，用评测结果给每个模型打标签、写简介（哪种芯片、哪个系统上跑得最好，中文、中英夹杂各什么水平），推荐可以给，选择留给用户。

他的原话："咱们不要去替任何人或者模型做主。咱们测出 benchmark、跑通 pipeline 后，给这些模型打上 tag，加上简介，说明它们在各个场景下的具体表现就行。"

**Why:** 项目有了反响，用户的机器各不相同（已有人 fork 去做 Windows），一个"官方首选"替不了所有人。
**How to apply:**
- 推荐写成"在某种机器上最合适"，不写成唯一答案。例：Apple 芯片上 Qwen3-ASR 0.6B 的 Q8（transcribe.cpp 加 Metal）最准，SenseVoice Q8 最快。
- 标签只来自实测数据，没测过的平台（Windows、Intel）写"未实测"，不按推测打标签。
- Windows 上的原生端到端测试暂时放下，先把能在本机做的做好。
- 评测流程见 bench/README.md，判官是 Claude，见 [[bench-judge-is-claude]]；两条链路的关系见 [[speakmore-two-pipelines]]。
