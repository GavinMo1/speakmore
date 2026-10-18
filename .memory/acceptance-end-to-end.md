---
name: acceptance-end-to-end
description: 验收必须端到端闭环；实在没什么功能要验，也至少把最终产物真启动一次、确认能起来，再说做完了
metadata:
  type: feedback
---

每次交付都要端到端闭环验收：改了什么，就沿用户真实会走的路径走一遍，拿到结果再汇报。实在不需要验证具体功能，也至少要把最终产物（打好的包、装好的 App、部署上去的站）真启动一次，确认启动没问题。

**Why:** 2026-10-17 他定的，原话"每次都得端到端闭环，如果实在不需要验证啥，也要确保启动没问题，这是这次的教训"。0.9.0、0.9.1 的 Mac 版 App 一启动就报 ERR_MODULE_NOT_FOUND，是用户在 GitHub 上报的（issue #4）：主进程引用了打 .app 时剔掉的 src/cli。单测全绿，ship 只核对版本号和校验值，发出去的 App 谁都没真打开过。

**How to apply:**
- 发版：ship 完下载线上的安装包，挂载或装好后真启动一次，看到日志里的 started 再说"发好了"；Mac、Windows 各自的包都要起一次（Windows 用开发机的脚本，见 docs/development.md）。
- 改了 App、安装、打包、启动路径：用打好的包验证，不只跑单测、不只从源码起。
- 启动验证用隔离的 SPEAKMORE_HOME，不碰他的真数据；在他的 Windows 桌面会话里跑东西前照旧先问。
- 汇报写清怎么验的、看到了什么；没验到的点名说明原因，不拿"单测全绿"顶替。
- 能自动化的就接进流程（比如 ship 里加一步启动冒烟），不靠记得。
- 不同步干等（2026-10-18 他说的："打 Windows 会快……打出来的时候你就直接并行地……去验证，不要同步阻塞"）：ship 里 Windows 包先打好，一出来就拷到 Windows 开发机上跑端到端；Mac 的 dmg 公证完一出来就挂载验，都在后台挂着，和上传并行。
- Mac 上启动验证的 SPEAKMORE_HOME 要短：会话临时目录的路径太长，超过控制套接字 103 字节的上限，App 照设计报错退出、不写日志。用 `mktemp -d "$TMPDIR/sm.XXXX"`，验完删掉。
- issue 等正式版发出、各平台验收都过了再回复并关闭，中途不回（10-18 他说的）。

相关：[[speakmore-release-on-cos]]、[[typeless-clone-as-real-product]]
