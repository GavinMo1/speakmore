---
name: speakmore-i18n-next
description: 下一个需求：客户端多语言，先加英文且默认英文；内核的语言不动
metadata:
  node_type: memory
  type: project
  originSessionId: 6b5e9ce5-00ff-48cc-99ba-a927306fc7c3
  modified: 2026-10-15T05:41:29.790Z
---

2026-10-14 他定的下一个需求：SpeakMore 客户端做 i18n，支持多语言；第一步先支持英文，并且**默认是英文**。只改客户端的语言，**内核里的语言不动**（提示词、整理出来的成品文字照旧）。

**Why:** README 已改成英文为主（见 [[readme-english-first]]），界面却只有中文，英文用户用不了。

**How to apply:** 动手前先跟他对齐这几处边界（截至记下时还没问）：
- `speakmore` 命令行的输出算不算客户端；
- 内核报上来、在界面里显示的话（比如模型出错的原因、"还差：Gemini 验证"）跟不跟着换；
- "默认英文"是不管系统语言一律英文，还是跟随系统、认不出时用英文；设置里要不要能切换语言。

做法照项目惯例：开分支、测试先行、文案短词短句（[[desktop-copy-and-look]]）。
