---
name: speakmore-translation-features
description: 翻译输入（说 A 语言出 B 语言）和划词翻译：10-22 定了壳的结构（功能是热键动作，引擎分语音、文字两段）、名字、触发方式、数据隐私下不提供；原型在画
metadata:
  node_type: memory
  type: project
  originSessionId: 4b3f4054-1581-427e-aaee-1842cfa6c5c8
  modified: 2026-10-22T12:32:53.046Z
---

2026-10-22 发完 0.15.0 后他提的两个功能。他的判断：内核几乎全复用，难的是“壳”，名字和板块不能乱。顺序是先理清产品形态、画清原型，再开发。

**10-22 他在选项里定了四件（都是我推荐的）：**
1. **结构**：功能 = 热键动作（`src/hotkeys/actions.mjs` 的动作目录）。引擎按入口分两段：
   - 语音：现在这棵树，语音输入和翻译输入共用。原生方式让模型直接出目标语言；转写方式的第二跳换提示词。“润色”这个环节名要换成中性的词，我提的是“成稿”，还没定。
   - 文字：给划词翻译用，单选一个文字模型，默认和第二跳同一个。
2. **名字**：语音输入、翻译输入、划词翻译。他口头说的“同声传译”严格讲是边说边出，会议同传那种，离会议软件太近，所以不用这个名字。
3. **划词只用热键触发**：不做“选中就冒图标”。
4. **数据隐私方式第一版不提供翻译**：本机的 Qwen3-ASR、SenseVoice 只能转写，那条路上也没有文字模型。界面写明原因，留缝以后接本机文字模型。

**我提过、他还没表态的：**
- 语言只设一组：母语加常用外语（可多个）。翻译输入出外语；划词出母语，选中的本来就是母语时出外语。
- 划词结果弹卡片，不贴字。卡片上放“复制”和“替换选中文字”。
- 翻译输入照进历史，原文和译文都存；首页的口述统计不算划词；花费都记。

**参照**：
- Typeless 的翻译是第三个热键（Fn + 左 Shift，Windows 是右 Alt + 右 Shift），和听写共用悬浮条和后端，只多一个 `output_language`（`targets/typeless/docs/04-voice-pipeline.md:99`）。目标语言在悬浮条上悬停切换，2.0 起能预存几个。
- Typeless 没有划词翻译。Easydict 有选中冒图标和 ⌥D 两种。

**没验证**：原生方式那几个收音频的模型能不能纯文字进出。

**原型**：放在 `.playwright-mcp/translate-proto/`（已 gitignore），做法照 [[plaza-tree-prototype]]：用真页面和造的数据，只在本机看（[[html-stays-local]]）。

相关：[[typeless-clone-scope-dictation]] [[decisions-as-options]] [[speakmore-hotkey-any-key]]
