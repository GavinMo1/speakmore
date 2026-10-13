---
name: typeless-clone-scope-dictation
description: 仿刻（SpeakMore）只做语音转写（单击热键听写加历史），用户已明确，其他模式不做
metadata:
  node_type: memory
  type: project
  originSessionId: fc395de3-9408-4fc0-a1cd-c93df2b01863
  modified: 2026-10-13T08:27:46.699Z
---

仿刻范围已定：只做语音转写这一个功能。用户 2026-10-13 的原话："我们只仿刻语音转写的这一个，因为我就用过这个"。他的用法是按一次 fn、说话、再按一次，结果落到选中的输入位置，并存进历史记录。

**Why:** 逆向 Typeless 的目的是学习，之后仿刻一个服务端自建的玩具。翻译模式和"问任何事"他没用过。

**How to apply:** 仿刻的设计、文档和后续抓包都只围绕"单击听写 → 插入到焦点输入框 → 存历史"。翻译、问任何事、云同步、企业策略不做，也不用再为它们补逆向。同一天我告诉他：就这个范围而言客户端逆向已经够开工，逆向不出来的是服务端的识别和清洗（模型、提示词），那部分要自己设计；这个"够开工"是我的判断。相关：[[rea-is-the-primary-tool]]、[[user-action-requests-plain-steps]]。
