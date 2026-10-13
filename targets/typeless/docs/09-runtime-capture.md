# 09 运行时抓包

状态：**工具就绪，尚未执行**。本篇先写方案和操作步骤，结果抓完后补在末尾。

## 为什么常规办法不好用

- 渲染进程的会话设了直连（`setProxy({mode:"direct"})`），系统代理抓不到 WebSocket。
- 主进程用 Node 自带的 `fetch`，不认系统钥匙串里的证书，装了抓包证书也会校验失败。
- 签名开了 hardened runtime 且没有调试权限，不能注入，不能挂调试器。
- asar 有完整性校验，不能改包。

## 用它自己留的开关

`app-settings.json` 里的 `__DEV_API_HOST`（[03](03-process-architecture.md#开发者留下的开关)）：设成一个不含 `typeless.com` 的主机后，主进程和渲染层的 HTTP、WebSocket 都改连它，并且用明文协议。签名和鉴权中间件对任何主机都照常生效。

于是：

```
Typeless ──明文 http/ws──▶ 127.0.0.1:8787（本机 mitmdump，reverse 模式）──TLS──▶ api.typeless.com
```

不用装证书，不用改系统设置，也不动安装包。mitmdump 写出的原生抓包文件可以直接交给 REA 的 `inspect_web_network_capture`。

### 上下文是密文的问题

`audio_context` 在客户端里就被 RSA 信封加密了，抓到的也是密文。可选的解法（`--decrypt-context`）：

1. 代理把 `/user/get_user_info` 回包里的 `rsa_public_key` 换成本机临时生成的公钥，同时记下真实公钥。
2. 客户端于是用我们的公钥加密上下文。
3. 代理收到后用临时私钥解开，把明文存盘，再用真实公钥按同样格式重新加密，转发给服务端。

服务端收到的内容与正常情况等价。临时私钥只在代理进程的内存里。

副作用：抓包期间新产生的那几条历史记录，本机数据库里存的上下文是用临时公钥加密的，以后谁也解不开（原本你自己也解不开）。云同步没开，不影响别的。

### 自测结果

2026-10-12 做过一次不涉及 Typeless 的自测：起代理，用 curl 经它请求 `GET /app/get_blacklist_domain`，服务端回 `405 Method Not Allowed`（31 字节，250 ms）。说明转发链路通、服务端没有因为连接来自 mitmproxy 就拒绝、记录文件正常写出。带登录态的请求和 WebSocket 还没有经过它，TLS 指纹校验（[05](05-network-protocol.md#请求签名)）会不会拦，要实际跑了才知道。

## 操作步骤

需要你配合的只有两处：退出/启动 Typeless，以及说几段话。

```bash
cd targets/typeless

# 终端 A：起代理（一直开着）
tools/capture.sh start --decrypt-context

# 终端 B
# 1. 先手动退出 Typeless（菜单栏图标 → Quit）
tools/capture.sh on          # 写入开关，原设置备份为 app-settings.json.before-capture
# 2. 启动 Typeless，确认悬浮条正常
# 3. 做下面的场景
# 4. 再次退出 Typeless
tools/capture.sh off         # 移除开关
# 5. 启动 Typeless，恢复正常使用；回到终端 A 按 Ctrl-C 停代理
```

`on` / `off` 会检查 Typeless 是否在运行，在运行就拒绝执行：它运行时会回写设置文件，把改动冲掉。

如果第 2 步后 Typeless 表现异常（登录掉了、听写一直转圈），直接跳到第 4 步恢复即可，抓到的部分照样有用。

### 建议的场景

每个场景说一两句就行，中间停几秒，方便事后按时间对上：

| # | 场景 | 想验证什么 |
| --- | --- | --- |
| 1 | 备忘录里空白处，说一句短的中文 | 基线：消息序列、各阶段耗时 |
| 2 | 备忘录里已有几行文字，光标放中间，说一句 | 光标前后文字是否都被带上 |
| 3 | 说一段 20 秒以上的长句，中间自我纠正一次（"周三，不对，周四"） | 多个音频块、逐块识别结果、清洗效果 |
| 4 | 中英文混着说一句 | 语言处理 |
| 5 | Chrome 里随便一个网页的输入框 | 网址、标题、可见文字 |
| 6 | 微信的聊天输入框 | 黑名单到底挡了哪些字段 |
| 7 | Cursor 或 VS Code 里 | 白名单应用、代码上下文 |
| 8 | 选中一段文字，用"问任何事"（Fn+Space）说"翻译成英文" | `selected_text`、`set_mode_config` |
| 9 | 翻译模式（Fn+左 Shift）说一句 | `output_language` |
| 10 | 听写后，手动改掉结果里的一个词，等 15 秒以上 | `/user/traits` 上报的内容 |
| 11 | 按一下快捷键立刻松开（不到半秒） | 短录音的处理 |
| 12 | 按住听写键 2 秒再松开（不要说话） | 静态结论"不支持按住说话"是否成立：预期出现"不要按住"提示，且不产生识别请求（[10](10-interaction-state-machine.md)） |
| 13 | 不选中任何文字，用"问任何事"说"帮我搜一下今天的天气" | `delivery` 的取值，`external_action`、`web_metadata` 的实际内容（[14](14-result-delivery.md)） |

## 输出

`_work/capture/<时间>/`（不进仓库）：

| 文件 | 内容 |
| --- | --- |
| `flows.mitm` | mitmproxy 原生抓包，交给 REA `inspect_web_network_capture` |
| `http.jsonl` | 每个 HTTP 往返一行；`Authorization`、`X-Authorization`、Cookie 只留长度 |
| `ws.jsonl` | 每条 WebSocket 消息一行；二进制帧只记长度和前 8 字节 |
| `context/NNN.json` | 解出的上下文明文 |

注意 `flows.mitm` 是原始抓包，里面有完整的令牌和签名头，只留在本机。

## 备选方案

如果开关方案被服务端拦了：

- **调试端口**：fuses 允许 `--inspect` 和 `--remote-debugging-port`。带参数启动后，REA 的 `list_electron_targets`、`capture_electron_scenario` 可以被动观察渲染进程；REA 的被动观察不记录请求体和凭据，要看内容得另接 CDP 的 Network 域。渲染层的 `window.ipcRenderer.invoke` 没有白名单，也可以直接调 `audio-context:get-audio-context` 看加密前的上下文。
- **只看明文上下文**：单用上一条的 IPC 探测就够，不需要任何网络拦截。

## 结果

（待补）
