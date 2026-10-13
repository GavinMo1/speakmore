# 91 未决问题

分三类：等抓包就能回答的、需要再读代码的、客户端里原则上看不到的。

## 等抓包回答

| # | 问题 | 现在的依据 |
| --- | --- | --- |
| Q01 | `start_audio` 消息的完整字段，初始上下文是随它发还是单独发 | 只读到状态机里构造的那部分字段 |
| Q02 | 黑名单应用（微信）里，光标前后文字和整框内容是否真的照发 | 代码里黑名单条件不覆盖 `getCurrentInputState` |
| Q03 | `visible_screen_content` 实际有多长、长什么样 | 上限参数 10000 |
| Q04 | `device_environment` 有哪些字段 | 未展开 |
| Q05 | WebSocket 是常驻还是按需建立，保活间隔 | 有 `ping`/`pong`、有上线自动重连 |
| Q06 | 从 `end_audio` 到 `refine_completed` 的实际耗时；`transcription` 逐块消息的内容和延迟 | 无 |
| Q07 | WebSocket 与 HTTP 赛跑，实际谁赢的比例 | 本机记录里没有这个字段 |
| Q08 | `/user/traits` 实际上报的内容和触发频率 | 代码 |
| Q09 | 服务端是否做 TLS 指纹校验，经代理转发会不会被 418 | 字段名 `ja3_tls_code`；自测的免登录请求没被拦 |
| Q10 | `taking_longer_alert_delay_ms` 为什么本机是 7000 而代码默认 6000 | 未查 |

## 需要再读代码

| # | 问题 |
| --- | --- |
| Q11 | 登录流程：`typeless://` 回调、`exchange_app_login_code`、令牌刷新、`user-data.json` 的加密方式 |
| Q12 | 历史云同步引擎（约 1500 行，6 个类）：推拉协议、冲突处理、墓碑 |
| Q13 | 悬浮条状态机的完整状态图 |
| Q14 | `delivery`、`external_action`、`web_metadata` 的实现，结果卡片窗口 |
| Q15 | 录音器内部：AudioWorklet 的重采样、分块、静音检测、"麦克风动态降级" |
| Q16 | 快捷键匹配规则（`ShortcutDetector`）：单按、长按、双击分别怎么判 |
| Q17 | 统计事件清单：发了哪些事件、各带什么属性 |
| Q18 | 更新流程；`enterprise-policy:updated` 是什么 |
| Q19 | 按键事件在 JS 层的全部去向（现在只确认了两个用途） |
| Q20 | 剪贴板恢复的延时；`bottomUpURLTraversalWhitelist` 的内容；黑白名单里"白名单"的作用 |
| Q21 | `desktopCapturer`、摄像头、蓝牙、屏幕录制的用途说明对应什么功能 |
| Q22 | 两个 Opus 库的参数（`session_create` 的四个 int 是什么） |

## 客户端里看不到

| # | 问题 |
| --- | --- |
| Q23 | 服务端用什么模型做识别和清洗，提示词是什么 |
| Q24 | 上下文在服务端怎么用、存多久 |
| Q25 | `debug_info` 的内容（服务端密钥加密） |
| Q26 | 个人词典和"修改跟踪"在服务端怎么影响下一次结果 |

Q23 可以从外部行为侧面推：抓包后看 `transcription`（逐块原始识别）和 `refine_completed`（成品）的差别，就能归纳出清洗做了哪些事。
