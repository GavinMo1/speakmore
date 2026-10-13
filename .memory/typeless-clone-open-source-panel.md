---
name: typeless-clone-open-source-panel
description: 仿刻定名 SpeakMore，在 speakmore/ 下；现阶段按开源标准打磨，先做成 CLI 驱动（一条命令启动、填 key 就能用），桌面端 App 以后用 Tauri 做
metadata:
  type: project
---

Typeless 的仿刻定名 **SpeakMore**，代码在仓库根的 `speakmore/`（一个 npm 包，命令 `speakmore`）。用户 2026-10-13 起的名，原话："给这个产品起个名,speakmore,和typeless反着来"。记忆文件名里的 "typeless-clone" 指的都是它。

现阶段的目标是达到能开源的标准。用户 2026-10-13 的原话：

> 目标就一个：开源的第一步，是让用户一行命令就能把整个项目拉起来。桌面端 App 的事可以先往后放，咱们桌面端 App 是用 Tauri 框架去做，那是之后的事。现在要做到的是：用户输一行命令，填写一下 Gemini 的密钥，这东西就可以用了。这相当于在上面封装一层，把这些启动流程都简化掉，它自己去找配置。

> 要先做成 CLI 驱动的方式。在这个 CLI 里可以启动、可以查看历史（就像 Typeless 一样），也可以看一些配置之类的。先把 CLI 系统搭起来，这是产品的第一步，之后再去做桌面端 App 的事。

**Why:** 上一轮做成了"打包成应用 + 设置窗口"，他看过后把衡量标准换成"陌生人从仓库拿到就能跑起来"，并且认为当时只打包了客户端、不够彻底。图形界面的主窗口他打算以后用 Tauri 另做，所以现在不在 Electron 上继续堆界面。

**How to apply:**

- 评判每个决定时问"一个刚拿到仓库的人，要几步才能说出第一句话"。安装步骤、报错、README 都按这个人写；自己照陌生人的路径真跑一遍（打成包装到别处、在伪终端里走第一次使用），2026-10-13 这样跑出了三个单看代码发现不了的问题。
- 入口是 `speakmore` 命令。新功能先想它在命令行里是什么样；不要往 Electron 的窗口里加新界面，那部分等 Tauri。现有的悬浮条、菜单栏、设置窗口保留，打成 .app 的脚本也还在，但都不是主路径。
- 范围仍受 [[typeless-clone-scope-dictation]] 约束，只做语音转写。原版主窗口的三张截图（首页的统计、历史、词典）存在 `targets/typeless/_work/ui-reference/`，不进 git；词典还没做，它对应现在和原版差得最多的地方（专有名词听错），做之前问一句。
- 开源前他定下的几件事：`.memory/` 保留并随项目迁移，工作习惯可以公开，逆向文档保留，本机情况改成配置驱动（[[machine-facts-stay-local]]），git 历史里泄露隐私的内容要抹掉。
- 包现在标着 `private`，没有发到 npm，仓库也还没公开。这两步和选许可证都要他点头，我不自己做。

相关：[[typeless-clone-as-real-product]]、[[typeless-clone-real-recordings-ok]]、[[typeless-clone-gemini-key]]。
