---
name: speakmore-hotkey-any-key
description: 热键开放成任意键或两键组合（配置驱动）；10-21 调研完，报告在 docs/hotkey-research.md，等他拍板 12 个决定再动手
metadata:
  node_type: memory
  type: project
  originSessionId: c790f439-dd17-4af4-a34b-18711867efb4
  modified: 2026-10-21T06:59:19.601Z
---

2026-10-20 他提的：热键绑定做成配置驱动，选的是"开放成任意键或组合键"（用户在设置里录任意键或组合键，存进配置），不是只把键表合成一份。10-21 补充：以后加别的功能要绑别的热键、要能改键，组合"两个键最多"；先纯调研、存文档，不直接开干。

现状：只能选一个单独的修饰键（Mac 四个、Windows 两个），键表在 native/main.swift、native/windows/keys.go、src/storage/settings.mjs 和 Windows 报错文案四处。

10-21 调研做完：Typeless 逆向、仓库现状、macOS、Windows、跨平台设计五路，加一轮对抗性审查（20 条全改进去）。报告 `docs/hotkey-research.md`，分路笔记和审查意见只在本机 `.playwright-mcp/hotkey-research/`。要点：底层仍是 CGEventTap / WH_KEYBOARD_LL，键用 W3C code 名、JS 里一张键表，匹配和吞键在小帮手里做，绑定表用 `bind` 下发；设置只写一处保证退回旧版起得来，`status.hotkey` 不改格式、组合放 `dictateCombo`。

**Why:** 顺着目录重构"写死的都改成配置驱动"的思路提的；以后加功能要绑新热键。
**How to apply:** 动手前先让他拍板报告 1.2 节的 D1–D12（建议都写在第 7 节），再先跑 7.2 里影响设计的真机实验（V1、V8、V19、V20）。开 feature 分支，按第 6 节的步骤一步一提交。
