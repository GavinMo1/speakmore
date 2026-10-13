# 91 未决问题

分四类：等抓包就能回答的、需要再读代码的、客户端里原则上看不到的、已经回答的。

## 等抓包回答

| # | 问题 | 现在的依据 |
| --- | --- | --- |
| Q01 | `start_audio` 消息的完整字段，初始上下文是随它发还是单独发 | 只读到状态机里构造的那部分字段 |
| Q02 | 黑名单应用（微信）里，光标前后文字和整框内容是否真的照发 | 代码里黑名单条件不覆盖 `getCurrentInputState` |
| Q03 | `visible_screen_content` 实际有多长、长什么样 | 上限参数 10000 |
| Q04 | `device_environment` 有哪些字段 | 未展开 |
| Q05 | WebSocket 首次建立的时机、保活间隔 | 已知空闲 1 小时断开、发消息时按需连接 |
| Q06 | 从 `end_audio` 到 `refine_completed` 的实际耗时；`transcription` 逐块消息的内容和延迟 | 无 |
| Q07 | WebSocket 与 HTTP 赛跑，实际谁赢的比例 | 本机记录里没有这个字段 |
| Q08 | `/user/traits` 实际上报的内容和触发频率 | 代码 |
| Q09 | 服务端是否做 TLS 指纹校验，经代理转发会不会被 418 | 字段名 `ja3_tls_code`；自测的免登录请求没被拦 |

## 需要再读代码

| # | 问题 |
| --- | --- |
| Q12 | 云同步里没读的部分：`load_older` 回填、`applyPulledTombstonesToLocal`、`acknowledge_hints`、谁调用 `invalidateSession`（主干已在 [13](13-history-cloud-sync.md)） |
| Q13 | 状态机里 `stopping`、`finishing`、`retrying` 的内部细节（主干状态图已在 [10](10-interaction-state-machine.md)） |
| Q14 | 结果卡片窗口内部怎么渲染、有哪些后续操作（投递分流已在 [14](14-result-delivery.md)） |
| Q15 | 录音器里分块边界怎么切、"麦克风动态降级"的实现（采样与编码参数、无声检测已在 [11](11-audio-recorder.md)） |
| Q16 | 原生层 `ShortcutDetector` 的规则（JS 侧的快捷键会话已在 [10](10-interaction-state-machine.md)） |
| Q17 | 统计事件的完整清单和各自属性（字面量搜到 13 个，是下限） |
| Q18 | 渲染层多久查一次更新；企业策略里"不允许成员云同步"那条分支做了什么；`enterprise-policy:updated` 的触发时机（主干已在 [15](15-update-policy-permissions.md)） |
| Q19 | 排障向导的数据打包后发往哪个接口 |
| Q20 | 剪贴板恢复的延时；`bottomUpURLTraversalWhitelist` 的内容 |
| Q21 | 原生库里有没有用到摄像头、蓝牙、屏幕录制（JS 侧已查，见 [15](15-update-policy-permissions.md#权限)） |
| Q27 | 登录相关的四个旧接口（`signin_with_google` 等）还有没有调用方；服务端时间偏移量何时校准；切换账号时清理了什么 |
| Q22 | `libopuschunk_session_create` 第四个参数的含义（前三个是采样率、声道数、码率）；`opus_convert_advanced` 的参数 |

## 客户端里看不到

| # | 问题 |
| --- | --- |
| Q23 | 服务端用什么模型做识别和清洗，提示词是什么 |
| Q24 | 上下文在服务端怎么用、存多久 |
| Q25 | `debug_info` 的内容（服务端密钥加密） |
| Q26 | 个人词典和"修改跟踪"在服务端怎么影响下一次结果 |

Q23 可以从外部行为侧面推：抓包后看 `transcription`（逐块原始识别）和 `refine_completed`（成品）的差别，就能归纳出清洗做了哪些事。

## 已回答

| # | 问题 | 结论 | 出处 |
| --- | --- | --- | --- |
| Q10 | `taking_longer_alert_delay_ms` 为什么本机是 7000 | 是公式算的：6000 加上按录音时长和选中文字长度的增量。没有拿那条记录的实际时长核对 | [14](14-result-delivery.md#成品里的时间参数) |
| Q11 | 登录流程与令牌存储 | 系统浏览器加 PKCE 加自定义协议回调；令牌文件的加密密钥由公开常量派生，没有用钥匙串 | [12](12-account-and-login.md) |
| Q12（主干） | 云同步的推拉协议、冲突、墓碑 | 只同步文字；云端优先；删除用墓碑 | [13](13-history-cloud-sync.md) |
| Q14（主干） | `delivery` 等字段怎么用 | 服务端决定投递方式：插入、结果卡片、打开外链 | [14](14-result-delivery.md) |
| Q16（JS 侧） | "按住说话"是否支持 | 2.8.1 不支持，按住超过 600 ms 会取消并提示。静态结论，抓包场景 12 复核 | [10](10-interaction-state-machine.md) |
| Q18（主干） | 更新流程、企业策略 | electron-updater 加静态文件源；企业策略管历史保留上限和云同步许可 | [15](15-update-policy-permissions.md) |
| Q19 | 主界面里对按键通道的订阅 | 排障向导的快捷键检测，记录打包前会删掉 | [10](10-interaction-state-machine.md#按键事件怎么走) |
| Q20（部分） | 白名单的作用 | "保证可写"的应用，插入后不做不可编辑兜底 | [14](14-result-delivery.md#落进输入框之后) |
| Q21（JS 侧） | 屏幕录制、摄像头、蓝牙的用途 | 屏幕录制只有申请权限的预留逻辑；摄像头和蓝牙是打包模板的默认声明，没有使用处 | [15](15-update-policy-permissions.md#权限) |
