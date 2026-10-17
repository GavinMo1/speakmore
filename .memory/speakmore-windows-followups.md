---
name: speakmore-windows-followups
description: Windows 版 0.9.0 发布后还没做的：命名管道防抢占、对抗性审查剩下的低危项、开发机清理
metadata:
  type: project
---

0.9.0（2026-10-17）发布时，Windows 版对抗性审查里还没处理的：

- **命名管道可被别的账户抢占**（审查 #3，中危）：打算改成只有当前用户读得到的随机管道名。
- 低危：install.ps1 按 Ctrl+C 中断会留下 `.install.*` 临时文件；install.ps1 没有自动测试；`SPEAKMORE_HOME` 的路径没做规范化；本机模型加载到显卡没有超时；没有显卡的 Windows 也推荐 Q8 版；命令行有几处说法还写着 Mac；开始菜单快捷方式没带 AppUserModelID，从管理员终端装的话命令行连不上管道（EPERM）；延迟删除失败时没有报出来。
- **收尾清理**（等 Windows 开发告一段落）：删掉开发机上的 speakmore-dev 目录和所有 speakmore-dev 开头的计划任务，关掉本机到开发机的 SSH 隧道（端口 19333）。

**Why:** 发版前他要先上线，这些留到之后做；开发机是他的真机，不能留垃圾。
**How to apply:** 他提 Windows 相关的活时先看这里；在他的 Windows 桌面会话里跑东西前先问（之前被拒过一次）。相关：[[speakmore-release-on-cos]]。
