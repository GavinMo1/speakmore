---
name: rea-project-level-install
description: REA 在本项目是项目级安装（.mcp.json + .claude/skills），不写全局；升级、校验的命令，以及体检的已知假失败
metadata:
  node_type: memory
  type: project
  originSessionId: fc395de3-9408-4fc0-a1cd-c93df2b01863
  modified: 2026-10-13T03:33:12.188Z
---

REA（`morluto/rea`，npm 包 `rea-agents`）在本项目只装在项目级：MCP 注册在 `.mcp.json`（`npx -y rea-agents@<版本> mcp`，版本钉死），配套 skill 在 `.claude/skills/reverse-engineer-anything/`。**不要跑不带目录重定向的 `rea setup`**——它会写 `~/.claude.json` 和 `~/.claude/skills`，影响本机其他项目（含公司项目）。

**Why:** 用户 2026-10-12 选定"只是用、不 vendor 源码、只在本项目生效"，并亲手用 `claude mcp add --scope project` 注册了 MCP。

**How to apply:**
- 升级：改 `.mcp.json` 里的版本号，再用同一版本重装 skill，两者必须同版本：
  `CLAUDE_CONFIG_DIR="$PWD/.claude" npx -y rea-agents@<版本> setup --skill-client claude_code --yes`
  先加 `--dry-run --format json` 看计划，`plannedActions` 应只有一个 `install_skill`，目标在项目的 `.claude/skills/` 下。
- 校验 skill：`CLAUDE_CONFIG_DIR="$PWD/.claude" npx -y rea-agents@<版本> doctor --skill --client claude_code --format json`，看 `identity.skill.state == "aligned"`。不带 `--client claude_code` 时它查的是 `~/.agents/skills`，会误报 skill missing。
- 已知假失败（6.4.0 实测）：上面两条命令退出码都是 1、`setup` 返回 `needs_human`。原因是 REA 的体检只认用户级注册，并且把"没装原生引擎"算作不健康，所以会报 `registration:claude_code` 不通过。这不代表项目级安装有问题；REA skill 里"用 setup 修复注册"的建议在本项目不适用。
- 校验 MCP 本身：按 `.mcp.json` 的命令拉起服务做一次 `initialize` + `tools/list` 握手，看版本号和工具数（6.4.0 是 170 个，与 skill frontmatter 的 `tool_count` 一致）。
