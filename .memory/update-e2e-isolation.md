---
name: update-e2e-isolation
description: 真机测更新时要钉住 SPEAKMORE_APP 和 SPEAKMORE_BIN_DIR；临时签名的 SpeakMore.app 被 open 打开会弹麦克风授权，可能覆盖正式版的授权；Windows 上 install.ps1 会改开始菜单快捷方式和 Path
metadata:
  node_type: memory
  type: project
  originSessionId: 6b5e9ce5-00ff-48cc-99ba-a927306fc7c3
  modified: 2026-10-19T14:18:53.131Z
---

0.10.1 起更新在内核里（src/update），App 和命令行共用。真机测更新时容易碰到用户真在用的那一份，2026-10-19 踩过：

- **Mac 一定钉住 `SPEAKMORE_APP`**：不钉的话找 App 会落到 /Applications 里真的那个，测试家目录的更新会想把它也换掉。那次被"开发者不同"的核对挡住了，没动到。
- **一定钉住 `SPEAKMORE_BIN_DIR`**：他有终端安装，~/.local/bin/speakmore 指着真的家目录，安装脚本会把它改指过去。
- **临时签名的 SpeakMore.app 被 `open` 打开时，系统当成新应用**，会弹麦克风授权。应用标识和正式版一样，他点了允许以后，正式版的麦克风授权可能被覆盖，下次听写会再问一次。所以 App 那条路径要么只在发版前测一次，要么用命令行、App 不在跑的方式测。直接从 shell 执行 App 里的程序不会弹，因为权限算在终端头上。
- **Windows 上 install.ps1 会改写开始菜单的「SpeakMore」快捷方式，并往用户 Path 里加一项**，名字是固定的。测之前先备份，测完还原；脚本在会话临时目录的 e2e/win 下，有 prepare、start-app、restore 三个。
- 测试发布包（0.11.0 起的按块摆法）：版本号临时改成 `0.11.0-e2e.N` 这类预发号（install.sh 只认 0.11.0 及以上，预发号比正式版旧），`MAC_SIGNING_IDENTITY= MAC_NOTARY_PROFILE= node scripts/release/release.mjs` 不签名不公证也出 App 的清单；打两个版本，用前一个装、后一个当下载地址（`SPEAKMORE_INSTALL_BASE`）测更新。打包期间别 `git add -A`：10-19 就这样把临时版本号提交进去过一次。
- Mac 的测试家目录用短路径，别带 `//`：install.sh 要比对拼好的目录在不在家目录里（10-19 查出过 a//b 比不上的毛病，已修）。

**Why:** 第一次跑时差点去换他 /Applications 里的 App，他的 PATH 链接、开始菜单、麦克风授权也都是真的。
**How to apply:** 发版前真机测更新时，照 [[speakmore-release-on-cos]] 打本机测试包，环境变量先钉住再起 App；碰 Windows 桌面会话前照 [[speakmore-windows-followups]] 先问他。
