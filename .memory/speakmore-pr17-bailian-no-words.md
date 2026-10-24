---
name: speakmore-pr17-bailian-no-words
description: "PR #17（外部贡献）百炼转写没认出字回 400，10-24 合并并补成\"当空原文\"，跟下个版本发；智谱、MiniMax 的静音检测没 key 未复测"
metadata:
  node_type: memory
  type: project
  originSessionId: abb1c590-5137-4efe-b88f-657a8192a95e
  modified: 2026-10-24T07:35:42.749Z
---

2026-10-24 合并外部 PR #17，跟下一个版本发布（0.17.0 之后）。

- **问题：** 百炼的 qwen-audio-3.1、qwen-audio-3.0、fun-asr 没认出字（静音、只有杂音）时不回空原文，回 400 CLIENT_ERROR "ASR_RESPONSE_HAVE_NO_WORDS"。验 key 用的就是静音，所以检测失败，热键录不了音。qwen3-asr-flash 不受影响，它会回"。"。
- **PR 的改法：** 只在验 key 时接受这条回话。
- **我们补的（8b4fba4）：** 挪到百炼接口那一层统一当成空原文。这样按了热键没说话时也报"没有听到声音"，不再报百炼拒绝了请求。
- **已用真 key 验过的：** 四个型号检测都通过；杂音交出空文字；错的 key 仍报 401；真录音照常转写。OpenAI 和百炼音频直出的静音检测也正常。
- **还没验的：** 智谱、MiniMax 的静音检测。`with-key.sh` 里没有这两家的 key，等有 key 再测。
- **回复：** 已在 PR 下回了作者，PR 合并时自动关了。发版后不用再回。

相关：[[speakmore-pr14-on-demand-model]]、[[typeless-clone-gemini-key]]。
