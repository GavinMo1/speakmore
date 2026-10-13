# Typeless 逆向

目标：Typeless for macOS 2.8.1（`now.typeless.desktop`，build 2.8.1.130），一款语音输入工具。目的是学习它的实现，并为之后自己做一个同类玩具（服务端自建）提供依据。

分析主干是 [REA](https://github.com/morluto/rea) 6.4.0（MCP 工具 + 命令行），结论引用它返回的 Evidence ID。

## 当前进度

| 部分 | 状态 |
| --- | --- |
| 包结构、签名、权限 | 完成 |
| JS 层（主进程、预加载、渲染层）静态分析 | 主链路读透；账号、同步、更新、引导页只看了接口 |
| 原生库（4 个 Swift 动态库） | 接口与机制完成；逐函数只看了 3 个关键函数 |
| 本机数据 | 完成（上下文与调试信息是服务端密钥加密的，读不出明文） |
| 运行时抓包 | 工具就绪，**待执行**（需要你配合说几段话，见 [09](docs/09-runtime-capture.md)） |
| 可视化（HTML 阅读版） | 待抓包结果并入后生成 |

## 文档

| 编号 | 文档 | 内容 |
| --- | --- | --- |
| 00 | [总览](docs/00-overview.md) | 一页看完：它是怎么工作的、为什么快、发了什么出去 |
| 01 | [包结构与签名](docs/01-bundle-and-signing.md) | 包里有什么、签名、权限、Electron 安全开关 |
| 02 | [代码还原](docs/02-code-recovery.md) | 混淆形态、还原方法、REA 输入的选择 |
| 03 | [进程与窗口架构](docs/03-process-architecture.md) | 进程、窗口、IPC 通道、本地存储 |
| 04 | [语音主链路](docs/04-voice-pipeline.md) | 从按键到文字落进输入框的全过程 |
| 05 | [网络协议](docs/05-network-protocol.md) | 签名、WebSocket 消息、HTTP 接口表 |
| 06 | [上下文采集与隐私](docs/06-context-capture-and-privacy.md) | 采了什么、什么时候采、黑名单管到哪 |
| 07 | [原生库](docs/07-native-helpers.md) | 4 个动态库的接口、用到的系统 API、关键伪代码 |
| 08 | [本机数据](docs/08-local-data.md) | 数据库、录音、配置文件 |
| 09 | [运行时抓包](docs/09-runtime-capture.md) | 抓包方案、操作步骤、结果（待补） |
| 10 | [交互状态机与按键](docs/10-interaction-state-machine.md) | 按键事件流向、听写状态图、全部时间参数、统计事件 |
| 90 | [证据台账](docs/90-evidence-ledger.md) | Evidence ID 与结论对照 |
| 91 | [未决问题](docs/91-open-questions.md) | 还不知道的、还没验证的 |

## 目录

```
targets/typeless/
├── README.md
├── docs/          文档（进仓库）
├── tools/         自写脚本（进仓库）
└── _work/         原始产物：解包代码、还原代码、REA 证据、抓包、切片库（不进仓库）
```

`_work/` 里是从 Typeless 拆出来的代码和你本人的数据，被 `.gitignore` 挡住。文档只写机制和结构，不贴大段原始代码，不记录包内写死的密钥值。

## 复现

```bash
cd targets/typeless

# 1. 解包（只取应用自己的代码，跳过 node_modules）
node tools/asar-extract.mjs /Applications/Typeless.app/Contents/Resources/app.asar _work/asar dist package.json

# 2. 去混淆（一次性准备：mkdir -p _work/tooling && cd _work/tooling && npm init -y && npm i node@24 webcrack@2.16.0）
tools/deobfuscate.sh
tools/build-readable-tree.sh          # 生成 _work/readable/dist，作为 REA 的输入

# 3. REA 分析（在 Claude Code 里走 MCP，或用命令行）
npx -y rea-agents@6.4.0 analyze-javascript-application _work/readable/dist --json

# 4. 原生库（需要 Ghidra 12.1.4，见 docs/07）
export GHIDRA_INSTALL_DIR=<仓库>/.tools/ghidra_12.1.4_PUBLIC
lipo -thin arm64 <库> -output _work/native-thin/<库>.arm64.dylib
npx -y rea-agents@6.4.0 function _work/native-thin/libInputHelper.arm64.dylib _insertText --provider ghidra
```

## 边界

只做静态分析和对自己账号的流量观察。不做绕过订阅或额度，不碰别人的数据。服务端加密的内容（调试信息）不尝试破解。
