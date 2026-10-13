# 10 交互状态机与按键

悬浮条渲染进程里的 XState 状态机（readable:qA149QP2.mjs:6101-7400）和按键事件的流向。静态阅读的结论。

## 按键事件怎么走

```mermaid
flowchart LR
  Tap["键盘子进程<br/>事件监听"] -->|"当前按住的键（JSON 数组）"| Main["主进程<br/>16 ms 节流 · 50 ms 补发"]
  Main -->|"global-keyboard"| Bar["悬浮条"]
  Main -->|"global-keyboard"| Other["另外三个窗口"]
  Main -->|"onPressKeyboardKeys"| Track["修改跟踪"]
  Bar --> Short["快捷键会话判定"]
  Bar --> Hint["打字提示计数"]
  Short --> SM["听写状态机"]
```

- 原生层每次按键状态变化都回调一次，内容是**当前按住的全部键**：`[{keyCode, keyName, enKeyName}]`（readable:main/index.js:11833-11880）。不只是快捷键，普通字母键也在里面。
- 主进程把这份状态广播给四个窗口（通道 `global-keyboard`，readable:main/index.js:12754-12764）。
- 已确认的三个消费者：
  1. **快捷键判定**：悬浮条里一个 reducer 把按键变化转成 `PRIMARY_KEY.DOWN`、`HANDSFREE_KEY.UP` 这类事件喂给状态机。
  2. **修改跟踪**：见 [06](06-context-capture-and-privacy.md#插入后的修改跟踪)。它用一个固定集合（字母、数字、标点、回车、Tab、空格、删除）判断"用户在编辑"（readable:main/index.js:17221）。
  3. **打字提示计数**：见下。
- 设置页里录制快捷键的控件也订阅这个通道（CeQePRHT.js:31869）。
- 在这几处都没有看到把按键内容写盘或上传的代码。DNMdpbnK.mjs（主界面的大包）里还有一处订阅，没有读。

### 打字提示计数

悬浮条里有个小类（readable:qA149QP2.mjs:7860-7960）：当焦点在可编辑输入框里时，把你敲的可打印键（字母、数字、标点、空格）按 `{时间, 应用, 键名}` 记进一个队列，只保留最近 60 秒。队列超过 60 个就触发一次提示并清空，换应用也清空。推断提示内容是"你在打很多字，试试语音"。

也就是说它知道你最近一分钟敲了哪些键，但只用来数数，数据留在渲染进程内存里。

## 状态

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> initializing: 按下听写/问任何事/翻译键
  initializing --> awaiting: 麦克风就绪
  initializing --> handsFree: 就绪前已松开
  awaiting --> handsFree: 松开按键
  awaiting --> long_pressing: LONG_HOLD
  long_pressing --> idle: 松开 / Esc
  state recording_active {
    pushToTalk
    handsFree
    translationModeHandsFree
  }
  handsFree --> stopping: 再按一次 / 点完成 / Esc
  pushToTalk --> stopping: 松开主键
  recording_active --> stopping: 录音到上限 / 检测到全程无声
  stopping --> finishing
  stopping --> error
  stopping --> failure
  finishing --> idle: 收到成品
  finishing --> retrying
  retrying --> finishing
  error --> initializing: 再按键
  failure --> initializing: 再按键
```

图里的 `initializing` 实际是三个状态（`initializingForTapOrHold` / `ForHandsFree` / `ForTranslation`），`awaiting` 是 `awaiting_long_press_or_tap`。

要点：

- **按下就开始录**。进入 `initializing*` 的入口动作里就有 `startRecording`，不等判定是点按还是长按。
- **松开进入免提录音**：`awaiting_long_press_or_tap` 里收到按键抬起，转到 `recording_active.handsFree`，之后再按一次任意功能键结束。
- **`long_pressing` 的入口动作是"提示不要按住、只需按一下"并停止录音**（`showDoNotHoldJustPressAlertAction`、`stopRecording`）。
- `recording_active` 另有一个 `pushToTalk` 子状态（松开主键即结束），它是该复合状态的初始子状态，但上面的转移都显式指向 `handsFree`。什么情况下进 `pushToTalk`、`LONG_HOLD` 事件在什么条件下发出，取决于快捷键会话那个 reducer，没有读完。**所以"按住说话"在当前版本里到底是支持还是被劝阻，这里不下结论**，你用一下就能确认。
- `recording_active` 期间：每 100 ms 一个 tick 检查有没有该发的音频块；进入 1 秒后开始音量检测，判定全程无声则以"未检测到语音"结束。
- `finishing` 等成品，有超时定时器。

## 时间参数

| 参数 | 值 | 位置 |
| --- | --- | --- |
| 长按判定 | 600 ms | `LONG_PRESS_MS`，qA149QP2.mjs:6102 |
| 双击窗口 | 400 ms | `DOUBLE_CLICK_MS`，6101 |
| 等成品超时（听写） | 20 秒 | `VOICE_TRANSCRIPT_REFINE_TIMEOUT_MS`，6103 |
| 等成品超时（问任何事） | 30 秒 | `VOICE_COMMAND_REFINE_TIMEOUT_MS`，6104 |
| 单次录音上限 | 9 分钟，最后 1 分钟倒计时 | `MAX_DURATION_MS: 540000`、`COUNTDOWN_BUFFER_MS: 60000`，4191 |
| 音频分块 | 3000 ms | 4546；可用 localStorage `debug_audio_chunk_interval` 覆盖 |
| 发送检查间隔 | 100 ms | `socketTickTimer`，6193 |
| WebSocket 空闲断开 | 1 小时 | `socketIdleTimer`，6181 |
| HTTP 兜底延时 | 默认 6000 ms | UfR9-a2Z.js:10457 |
| HTTP 兜底超时 | 40 秒 | main/index.js:17905 |
| 按键广播节流 | 16 ms，另有 50 ms 周期补发 | main/index.js:12699-12701 |
| 修改跟踪 | 15 秒无编辑则结束 | main/index.js:17224 |
| 焦点轮询 | 1000 ms | main/index.js:11352 |

## 默认快捷键（本机设置）

| 功能 | 按键 |
| --- | --- |
| 听写 | `Fn` 或右 `Cmd` |
| 问任何事 | `Fn+Space` |
| 翻译 | `Fn+左Shift` |
| 再贴一次上一条 | `Ctrl+Cmd+V` |

前三个下发给原生层做监听目标；"再贴一次"不走原生监听（readable:main/index.js:12798-12812 里把它排除了），推断用的是 Electron 的全局快捷键。

## 统计事件

用字面量搜索在主进程和主要渲染层文件里找到 13 个事件名，经 `/app/metrics_mp` 上报：

- 错误类 10 个：`error_monitoring_` 前缀，包括 Opus 压缩失败、粘贴失败、上下文库初始化失败、RSA 加密失败、音频块积压、语音接口异常、更新失败、重试发起失败、旧表迁移出错、**检测不到输入框**。
- 性能类 2 个：录音初始化耗时、键盘监听重启。
- 点击类 1 个：分享洞察。

其中 `error_monitoring_undetectable_textbox_found` 带的属性有应用名、bundle id、**网页完整网址**和域名：当你在某个页面按了听写但它认不出输入框时，这个页面的网址会被上报一次（同一应用加网址只报一次，readable:main/index.js:11566-11578）。

事件名如果是变量拼出来的，这种搜法找不到，所以 13 是下限。
