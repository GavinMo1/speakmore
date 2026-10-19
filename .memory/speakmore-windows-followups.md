---
name: speakmore-windows-followups
description: Windows 版还没做的：命名管道防抢占、审查剩下的低危项、测试在 Windows 留临时目录；开发机 10-19 清过只剩开发要用的；0.9.3 做掉了按版本安装
metadata:
  type: project
---

0.9.0（2026-10-17）发布时，Windows 版对抗性审查里还没处理的：

- **命名管道可被别的账户抢占**（审查 #3，中危）：打算改成只有当前用户读得到的随机管道名。
- 低危：本机模型加载到显卡没有超时；没有显卡的 Windows 也推荐 Q8 版；命令行有几处说法还写着 Mac；开始菜单快捷方式没带 AppUserModelID，从管理员终端装的话命令行连不上管道（EPERM）。
- 0.9.3（issue #5）已经做掉的：程序按版本放进 versions\、current 记着用哪个，不挪不覆盖文件；`.install.*`、SPEAKMORE_HOME 规范化、删不掉的交给后台重试都随之解决。审查后又加了：不装 0.9.3 以前的版本、同一家目录同时只装一个、下载不走 Invoke-WebRequest（内存峰值 1952 → 262 MB）、升级时改指任务栏和桌面上的快捷方式副本。端到端脚本在会话临时目录（issue5/e2e3.ps1），十个场景。
- 还剩：`test/models/store.test.mjs`、`test/storage/history.test.mjs` 在 Windows 上每跑一次在 %TEMP% 留一个 speakmore-models-*/speakmore-history-* 目录（各一个文件，10-18 清过一次）；开机启动在程序路径带空格时显示成关着（记在 docs/implementation-notes.md）；快捷方式目标每个版本都变，按 exe 路径记的设置（显卡偏好、着色器缓存）每次升级重来，根治要一个固定位置的小启动程序加 AppUserModelID。
- 2026-10-19 用户说"清理干净"后，开发机上以前会话留的东西都删了：探测和安装、卸载试验的目录与计划任务、旧发布包、npm/Electron 缓存、rae-probe 系列、快照、%TEMP% 里测试留的目录。speakmore-dev 里现在只剩开发脚本要用的 repo、home、desktop、三个日志和计划任务 speakmore-dev（win-desktop.sh 默认的那个）。之后验收用 JOB= 另起的目录和计划任务，验完当场删。
- **收尾清理**（等 Windows 开发告一段落）：删掉开发机上的 speakmore-dev 目录和所有 speakmore-dev 开头的计划任务，关掉本机到开发机的 SSH 隧道（端口 19333）。

**Why:** 发版前他要先上线，这些留到之后做；开发机是他的真机，不能留垃圾。
**How to apply:** 他提 Windows 相关的活时先看这里；在他的 Windows 桌面会话里跑东西前先问（之前被拒过一次）。相关：[[speakmore-release-on-cos]]。
