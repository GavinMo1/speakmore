# 热键的按键轨迹样例

Mac（`native/mac/*.swift`）和 Windows（`native/windows/*.go`）两个小帮手各写了一遍匹配规则，这些样例约束两边的行为一字不差（`docs/hotkey-research.md` 5.3、第 6 节）。

- 这一层的 `*.json` 是手写的，键用 W3C code 名（`AltRight`、`Space`）。
- `mac/`、`win/` 是 `node scripts/build/hotkey-fixtures.mjs` 按 `src/hotkeys/keys.mjs` 换成原生码生成的，不要手改。改了样例或键表之后重新生成；`test/scripts/build/hotkey-fixtures.test.mjs` 会核对生成的和仓库里的一致。
- Go 测试读 `win/`，Swift 测试读 `mac/`。

每个文件是一组 `cases`。一个 case 有绑定表 `bindings`（`id`、`chord`、`when`），和一串 `steps`。每一步是下面几种之一：

| 写法 | 意思 |
| --- | --- |
| `{"key": "AltRight", "down": true}` | 一个按键事件。可选 `injected`（自己模拟的）、`t`（毫秒，默认上一步加 1）、`scan`（Windows 上覆盖扫描码，模拟系统补的假事件） |
| `{"capture": true}` | 父进程说"开始截"（`false` 是"不截了"） |
| `{"lostUp": "Tab"}` | 这个键已经松开，但松开的事件丢了（安全输入、管理员窗口会吞掉松开） |
| `{"reset": true}` | 监听停了又重新打开（tap 被系统停用、钩子重装、安全输入关掉、锁屏回来） |
| `{"bind": [...]}` | 父进程换了一份绑定表（写法同 `bindings`） |

每一步写期望：`events`（这一步报的事件，按顺序，默认没有），`swallow`（吞不吞，默认不吞），`mask`（只有 Windows：要不要插一下掩码键，默认不插）。事件的简写：`{"down": "dictate#0"}`、`{"up": "dictate#0"}`、`{"interrupted": "dictate#0"}`、`{"interrupted": "dictate#0", "to": "x#0"}`。

`platforms` 限定 case 只在哪个系统上生成（默认两个都生成），某一步加 `only` 也一样。
