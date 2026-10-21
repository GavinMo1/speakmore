---
name: speakmore-hotkey-any-key
description: 热键开放成任意键或两键组合（配置驱动、内部做干净、老用户无感）；报告 docs/hotkey-research.md 第三版 10-21 改完，等他拍板 D1–D13 再动手
metadata:
  node_type: memory
  type: project
  originSessionId: c790f439-dd17-4af4-a34b-18711867efb4
  modified: 2026-10-21T07:13:49.193Z
---

2026-10-20 他提的：热键绑定做成配置驱动，选的是"开放成任意键或组合键"（用户在设置里录任意键或组合键，存进配置），不是只把键表合成一份。10-21 补充：以后加别的功能要绑别的热键、要能改键，组合"两个键最多"；先纯调研、存文档，不直接开干。

现状：只能选一个单独的修饰键（Mac 四个、Windows 两个），键表在 native/main.swift、native/windows/keys.go、src/storage/settings.mjs 和 Windows 报错文案四处。

10-21 调研做完：Typeless 逆向、仓库现状、macOS、Windows、跨平台设计五路，加一轮对抗性审查（20 条全改进去）。报告 `docs/hotkey-research.md`，分路笔记和审查意见只在本机 `.playwright-mcp/hotkey-research/`。要点：底层仍是 CGEventTap / WH_KEYBOARD_LL，键用 W3C code 名、JS 里一张键表，匹配和吞键在小帮手里做，绑定表用 `bind` 下发。

10-21 压缩后他追加方向："彻底做成配置驱动，完完整整做干净，先不要考虑向后兼容"，理由是以后要加转写、翻译之类的功能，配置不好改就做不下去。当天他又补一句：只加十来行代码，但老用户必须完全无感，对他们来说能感知到的只有热键能自定义、能组合。报告第三版已按此改（分支 docs/hotkey-clean）。所以报告里为兼容留的尾巴（`hotkey`/`hotkeys.dictate` 两处存、`status.hotkey` 旧格式加 `dictateCombo`、`hotkeys` 等第二个动作再升格、第一版只开放听写改键、第 3 步保留 `--key` 过渡）都不要了。第三版：动作目录 `src/hotkeys/actions.mjs` 是唯一出处，每个动作生成一项普通设置 `hotkey.<动作>`（值是组合字符串），界面、命令行、状态按目录生成；旧写法只在入口认（第一次启动换算设置文件、`SPEAKMORE_HOTKEY`、`config set hotkey`），存的报的都是新写法；退回旧版用默认键照样起得来（`resolveSettings` 只遍历 SETTINGS，已核对）。唯一在输出上照顾旧写法的是 D13（`status --json` 旧字段留一版）。

**Why:** 顺着目录重构"写死的都改成配置驱动"的思路提的；以后加功能要绑新热键。
**How to apply:** 动手前先让他拍板报告 1.2 节的 D1–D13（建议都写在第 7 节），再先跑 7.2 里影响设计的真机实验（V1、V8、V19、V20）。开 feature 分支，按第 6 节的步骤一步一提交。
