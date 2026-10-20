---
name: speakmore-hotkey-any-key
description: 待做：热键开放成任意键或组合键（配置驱动），排在目录可配置重构发版之后单独做
metadata:
  node_type: memory
  type: project
  originSessionId: c790f439-dd17-4af4-a34b-18711867efb4
  modified: 2026-10-20T11:51:30.012Z
---

2026-10-20 他提的：热键绑定做成配置驱动，选的是"开放成任意键或组合键"（用户在设置里录任意键或组合键，存进配置），不是只把键表合成一份。排期：目录重构（[[speakmore-relocatable-home]]）发版后单独做。

现状：只能选一个单独的修饰键（Mac 四个、Windows 两个），键表在 native/main.swift、native/windows/keys.go、src/storage/settings.mjs 三处各一份。

**Why:** 顺着目录重构"写死的都改成配置驱动"的思路提的。
**How to apply:** 动手前先对齐细节：组合键怎么录、和系统快捷键冲突怎么办、悬浮条上的键帽怎么写、两个原生小帮手怎么认任意键码。
