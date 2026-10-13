# 05 网络协议

静态阅读得到的协议。实际字节层面的内容待抓包补充（[09](09-runtime-capture.md)）。

## 主机

| 用途 | 地址 |
| --- | --- |
| API | `https://api.typeless.com`（写死，readable:main/index.js:52） |
| 实时语音 | `wss://api.typeless.com/ws/rt_voice_flow` |
| 官网 | `https://www.typeless.com` |
| 更新 | `https://typeless-static.com/desktop-release/` |
| 崩溃上报 | Sentry（`o4510514257526784.ingest.us.sentry.io`） |

统计事件不直连第三方，发到自家的 `/app/metrics_mp`（从名字推断由服务端转给 Mixpanel）。

## 请求签名

每个发往 API 的 HTTP 请求过两个中间件（readable:main/index.js:3195-3364）。

**安全中间件**加这些头：

| 头 | 值 |
| --- | --- |
| `X-App-Version` | `mac_2.8.1` |
| `X-Browser-Name` / `-Version` / `-Major` | 运行环境信息 |
| `X-Authorization` | 见下 |

`X-Authorization` 的明文是一个 JSON：

```
{
  "X-Env": "prod",
  "X-Client-Domain": <来源页面的域>,
  "X-Client-Path": <来源页面地址>,
  "X-Random": <6 位随机数>,
  "t": <校正后的毫秒时间戳>,
  "p": <签名>,
  "d": <设备 ID>,
  "<一个固定的 40 位十六进制键>": { "a": "" }
}
```

- `p` = HMAC-SHA1(消息 = `t:版本:路径:用户ID`，密钥 = `t:固定盐`)。
- 整个 JSON 用 CryptoJS 的口令式 AES 加密（OpenSSL 兼容格式，Base64 后以 `U2FsdGVkX1` 开头），口令是写死在包里的一个常量。

固定盐和口令是两个 56 位十六进制常量，在 readable:main/index.js:56-57。本文档不抄录它们的值。

**鉴权中间件**加 `Authorization: Bearer <access_token>`。`/oauth/refresh_access_token` 和 `/get_blacklist_domain` 不需要登录。

**时间校正**：服务端回 418 且响应体里 `ja3_tls_code` 为 `101010101` 时，客户端取响应头 `Date` 算出与本地的时间差存起来，之后的 `t` 都加上这个差。WebSocket 的 `received_audio_chunk_count` 消息里的 `server_t` 也用来校时。字段名带 `ja3_tls`，推断服务端有基于 TLS 指纹的校验，具体规则未知。

**其他状态码**：401 有专门的中间件处理（主进程里那个回调是空的，渲染层的没读）；413 提示输入超出模型长度上限。

## 上下文加密信封

`audio_context` 等敏感字段发出前包一层（readable:main/index.js:3888-3909）：

```
{
  "_encrypted": true,
  "_v": 1,
  "_type": "json" | "str",
  "_key":  Base64( RSA-OAEP-SHA256( 随机 32 字节 AES 密钥 ) ),
  "_data": Base64( AES-256-GCM 密文 ‖ 16 字节认证标签 )      // IV 为 12 字节全零
}
```

- 公钥来自 `GET /user/get_user_info` 回包的 `data.rsa_public_key`（本机样本的 `_key` 是 344 个 Base64 字符，即 2048 位 RSA）。
- 取不到公钥时退回用写死口令的 AES，并上报一条 `error_monitoring_rsa_encryption_failed` 统计事件。
- 用到这层信封的地方：`audio_context`（WebSocket 和 HTTP）、`/user/traits` 的 `log`。

## WebSocket：`/ws/rt_voice_flow`

### 连接

```
wss://api.typeless.com/ws/rt_voice_flow?v=mac_2.8.1&t=<加密串>&m=0
```

`t` 是把 `{ token, s, t, d }` 用同一个写死口令 AES 加密后的串：`token` 是访问令牌，`s` 是对路径 `/ws/rt_voice_flow` 做的同款 HMAC-SHA1 签名，`t` 是时间戳，`d` 是设备 ID（readable:UfR9-a2Z.js:10783-10800）。

有 `ping`/`pong` 保活，断网后上线会自动重连，发消息时发现没连上也会先连。状态机在空闲满 1 小时后主动断开（[10](10-interaction-state-machine.md#时间参数)）。所以它是"用过之后保持一小时"的长连接，下一次按键时通常已经连着，省掉建连时间。

### 客户端 → 服务端

文本消息是 JSON，`type` 字段区分：

| type | 时机 | 主要字段 |
| --- | --- | --- |
| `start_audio` | 开始录音 | `audio_chunk_time`、`audio_sample_rate`、`audio_metadata`、`device_id`、`mode`（另由发送层补 `audio_id`、`audio_context` 等，待抓包确认完整字段） |
| `set_mode_config` | 非默认模式 | `audio_id`、`mode`、`parameters` |
| `set_selected_text` | （未读） | |
| `replace_audio_context` | 完整上下文取到后 | `audio_id`、`audio_context`（信封） |
| `set_audio_chunk_info` | 每个音频块之前 | `audio_id`、`index`、`size`、`duration` |
| （二进制帧） | 紧跟上一条 | Opus 音频块 |
| `end_audio` | 结束录音 | `user_over_time`、`send_time`、`audio_time`、`total_duration`、`start_recording_time`、`stop_recording_time`、`diff`、`mode`、两个延迟统计 |
| `ping` | 保活 | |

### 服务端 → 客户端

JSON，类型在 `K`（或 `msg_type`），内容在 `V`（或 `data`）：

| 类型 | 含义 | 内容 |
| --- | --- | --- |
| `session_started` / `audio_session_started` / `audio_session_ending` | 会话生命周期 | |
| `received_audio_chunk_count` | 确认收到的块数 | `server_t`（服务器时间，用来校时） |
| `transcription` | 某一块的识别文字 | `text`、`chunk_index` |
| `refine_completed` / `audio_processing_completed` / `refine_selected_text` | 成品 | `audio_id`、`refined_text`、`delivery`、`user_prompt`、`web_metadata`、`external_action` |
| `process_mode` | 服务端判定的处理模式 | |
| `important_notification` | 提醒或付费墙 | `type`、`alertKey`、`behavior.interruptSession`、`behavior.duration` |
| `debug_info` | 调试信息 | 加密串，客户端不解，原样存库 |
| `pong` | | |
| `error` / `transcription_error` / `refine_error` / `refine_selected_text_error` / `audio_processing_error` | 错误 | `code`、`detail` |

`transcription` 消息说明服务端是逐块出识别结果的，成品清洗在全部音频到齐后做一次。

## HTTP：语音兜底接口

`POST /ai/voice_flow`，`multipart/form-data`，超时 40 秒（readable:main/index.js:17817-17935）：

| 字段 | 内容 |
| --- | --- |
| `audio_id` | 本次录音的 UUID |
| `mode` | `transcript` / `ask_anything` / `translation` |
| `audio_file` | 整段音频，`audio/ogg` |
| `audio_context` | 信封加密的上下文（JSON 字符串） |
| `audio_metadata` | 音频参数 JSON，含 `audio_duration` |
| `parameters` | JSON：`selected_text` 或 `output_language` |
| `is_retry` | 是否用户手动重试 |
| `user_over_time`、`send_time`、`device_name` | 可选 |

回包 `data`：`refine_text`、`delivery`、`user_prompt`、`web_metadata`、`external_action`；顶层另有 `debug`。失败时可能带 `important_notification`、`detail`、`code`。

## HTTP：接口总表

主进程发起（REA 端点节点，机制为 `ye.get` / `ye.post`）：

| 接口 | 用途 |
| --- | --- |
| `POST /ai/voice_flow` | 语音兜底 |
| `POST /user/traits` | 上报插入后的修改 |
| `GET /user/get_user_info` | 用户信息、RSA 公钥 |
| `GET /app/get_blacklist_domain` | 黑白名单配置 |
| `POST /app/metrics_mp` | 统计事件（内容经写死口令 AES 加密） |
| `POST /sync/check` | 同步检查 |
| `POST /transcription_history/{push,pull,load_older,sync_status,sync_settings,acknowledge_hints,wipe}` | 历史云同步 |
| `POST /user/get_user_surveys`、`/user/submit_survey` | 引导问卷 |
| `/oauth/*` | 登录：`signin_with_google`、`auth_user_from_google`、`signin_with_email`、`verify_secret_code`、`exchange_app_login_code`、`refresh_access_token`、`logout` |

渲染层发起（在渲染层代码里找到的路径）：

| 接口 | 用途 |
| --- | --- |
| `/user/dictionary/{list,add,update,delete,batch-delete,bulk-import,bulk-import/preview}` | 个人词典 |
| `/user/get_dictation_settings`、`/user/set_dictation_settings`、`/user/update_settings` | 听写设置 |
| `/user/personal_stats`、`/user/usage_stats`、`/user/insights` | 使用统计 |
| `/user/feedback`、`/user/diagnostics_report` | 反馈与诊断（会带上服务端加密的调试信息） |
| `/user/get_invitation_codes`、`/user/submit_affiliate_code` | 邀请 |
| `/user/update_onboarding`、`/user/delete_account` | 引导、注销 |
| `/app/get_free_quota_notice_banner_config`、`/app/get_onboarding_copy_config` | 界面配置 |

各接口的请求体和回包结构，除语音主接口和 `/user/traits` 外都没有逐个读。

## REA 端点识别的一个误报

REA 的 `discover-static-endpoint` 把 electron-store 的 `.get("键名")` 也归成了 network 端点（76 条观察里约 50 条是这类）。上表只收了经 API 客户端发出的那些。
