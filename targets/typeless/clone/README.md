# Typeless 听写仿刻

照着[逆向文档](../docs/00-overview.md)做的一个玩具，只做一件事：按一下 fn 开始说话，再按一下结束，整理好的文字贴进当前输入框，并存进历史。翻译、问任何事、云同步都不做。

| 部分 | 状态 | 说明 |
| --- | --- | --- |
| [server/](server/) | 能用 | 本机服务端：收分块音频，交给 Gemini 整理成文字 |
| client/ | 还没做 | 按键、录音、贴字、历史 |

## 服务端

### 装和跑

需要 Node 22 以上，以及一把 Gemini 的 API key，通过环境变量 `GEMINI_API_KEY` 给。key 不要写进任何文件，也不要 `export` 到全局，用按需加载器只喂给这一个进程：

```bash
cd server
npm ci
withkey <凭据名> npm start
```

启动后监听 `ws://127.0.0.1:8790/ws/rt_voice_flow`，只接受本机连接。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GEMINI_API_KEY` | 无，必填 | |
| `GEMINI_MODEL` | `gemini-3.5-flash` | 换模型时注意下一项 |
| `GEMINI_THINKING_LEVEL` | `MINIMAL` | `MINIMAL` / `LOW` / `MEDIUM` / `HIGH`。`gemini-3.7-flash`、`gemini-3.8-flash` 不接受 `MINIMAL` |
| `PORT` | `8790` | |

### 不用客户端就能试

`scripts/replay.mjs` 把现成的 Ogg/Opus 文件当成一次录音发给服务端，每个文件算一块，打印每条回包、耗时和成品文字：

```bash
node scripts/replay.mjs 块1.ogg 块2.ogg
```

没有录音文件时可以用系统朗读合成一段：

```bash
say -v Tingting -o a.aiff "嗯，那个，我们明天，不对，后天下午开会"
ffmpeg -i a.aiff -ar 16000 -ac 1 -c:a libopus -b:a 32k a.ogg
```

### 检查

```bash
npm run check   # 代码检查 + 全部测试
```

测试不联网，模型那一步换成假的。

## 和原版的对应关系

协议照抄抓包看到的消息名和字段名（[05 网络协议](../docs/05-network-protocol.md#websocketwsrt_voice_flow)），只实现听写用到、并且仿刻客户端会发的那几条。

| 方向 | 消息 | 仿刻 |
| --- | --- | --- |
| 客户端 → 服务端 | `start_audio` | 只用 `audio_id`，其余字段收下不用 |
| | `set_audio_chunk_info` + 二进制帧 | 序号从 1 开始，按序收；每块必须是独立的 Ogg 流 |
| | `end_audio` | 只用 `audio_id` |
| | `set_mode_config`、`replace_audio_context` | 不实现（不采集上下文，只有一种模式） |
| 服务端 → 客户端 | `audio_session_started` | `{audio_id, start_time}` |
| | `received_audio_chunk_count` | `{index, server_t, size}` |
| | `audio_session_ending` | `{audio_id, total_chunks, completed_chunks, failed_chunks}`，这里数的是上传的块 |
| | `audio_processing_completed` | 九个字段与实测相同，听写用不到的五个固定为 `null` |
| | `audio_processing_error`、`error` | `{audio_id, code, detail}` |
| | `debug_info` | 不发 |

和原版不一样的地方：

- **没有登录和签名。** 服务只听本机端口，握手时拒绝带网页来源（`Origin` 为 `http(s)://…`）的连接，防止浏览器里的网页连进来花模型额度。
- **识别和整理是一次模型调用。** 原版服务端内部怎么做的看不到。各块首尾相接后整段发给 Gemini，不重新编码。
- **不采集上下文。** 原版会把当前应用、输入框内容、屏幕可见文字一起上传（[06](../docs/06-context-capture-and-privacy.md)），这里只上传录音。

## 选型时测到的数

测试音频是系统朗读合成的一段 20.7 秒中英混说，带口头禅和一次改口；不是真人录音，结论只能当起点。耗时是从本机经代理到 Gemini 的整次请求。

| 模型 | 思考档位 | 连接复用后的耗时 | 整理效果 |
| --- | --- | --- | --- |
| `gemini-3.5-flash-lite` | 默认 | 1.2–1.5 秒 | 口头禅删了，改口的痕迹（"不对，应该…"）留着 |
| `gemini-3.5-flash` | `MINIMAL` | 1.6–1.8 秒 | 改口处理对了，"就是说"有时留着 |
| `gemini-3.6-flash` | `MINIMAL` | 1.9–3.6 秒 | 同上 |
| `gemini-3.8-flash` | `LOW` | 2.3–3.3 秒 | 最干净 |
| `gemini-3.8-flash` | 默认 | 6–8 秒 | 最干净，思考用掉了大部分时间 |

原版实测是 `end_audio` 之后 1.4–1.9 秒出成品，所以默认选了 `gemini-3.5-flash`。

另外三个结论：

- **分块不用重新编码。** 7 个独立编码的 3 秒 Ogg 流首尾相接，Gemini 能从头识别到尾。
- **不能让模型在没有人声时"什么都不输出"。** 那样写时，3 秒静音 6 次里有 4 次编出了一句话。改成输出固定标记 `<无人声>` 后，静音和噪声各 6 次全部输出标记，服务端再把标记换成空字符串。
- **要求 JSON 输出会让整理变差。** 用 JSON 字段表达"有没有人声"时，模型不再处理改口，所以没有采用。

## 还没做的

- 客户端。
- 用真人录音评估和调提示词。同一段音频在温度为 0 时多次结果仍有出入，合成语音看不出这在真实使用里有多严重。
- 隔一阵后的第一次请求要重新建连，实测 4.1 秒，复用后是 1.6 秒左右。
