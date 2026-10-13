---
name: ghidra-project-local
description: Ghidra 12.1.4 装在项目内 .tools/，MCP 服务没带它的路径，原生分析要走 REA 命令行并先切单架构
metadata:
  node_type: memory
  type: project
  originSessionId: fc395de3-9408-4fc0-a1cd-c93df2b01863
  modified: 2026-10-13T05:13:03.462Z
---

本项目的原生反编译引擎是 Ghidra 12.1.4，解压在 `.tools/ghidra_12.1.4_PUBLIC`（被 `.gitignore` 忽略，不是全局安装）。官方包不带 macOS 原生反编译器，已用它自带的 `support/gradle/gradlew buildNatives` 在本机编出 `Ghidra/Features/Decompiler/build/os/mac_arm_64/decompile`（Gradle 缓存放在 `.tools/gradle-home`）。

**Why:** 2026-10-12 逆向 Typeless 时装的。REA 只接受 12.1.x，`rea doctor --provider ghidra` 在补完原生组件后报 healthy。

**How to apply:**
- `.mcp.json` 里的 REA 服务没有配 `GHIDRA_INSTALL_DIR`，所以 MCP 工具里依赖引擎的那 42 个不可用。原生分析走命令行：
  `GHIDRA_INSTALL_DIR="$PWD/.tools/ghidra_12.1.4_PUBLIC" npx -y rea-agents@6.4.0 function <库> <函数名> --provider ghidra --snapshot <快照.json> --format json --full-output`
  `--snapshot` 让后续调用复用同一次分析，首次约 35 秒。
- REA 的 Ghidra 引擎不接受多架构合一的 Mach-O，先 `lipo -thin arm64 <库> -output <切片>` 再分析。
- 想让 MCP 工具直接用 Ghidra，需要在 `.mcp.json` 的 `env` 里加这个变量并重连；改 `.mcp.json` 要用户自己操作（见 [[rea-project-level-install]]）。
- 抓包用的 mitmproxy 在 `.tools/venv-mitm`（Python 虚拟环境）。
- 相关：[[rea-is-the-primary-tool]]。
