# 06 上下文采集与隐私

这一篇回答：除了声音，它还读了什么、什么时候读、读了发到哪。

结论来自主进程的上下文采集类（readable:main/index.js:11340-11790）、悬浮条的调用点（qA149QP2.mjs:5750-5900）和修改跟踪类（main/index.js:17222-17480）。**明文样本还没拿到**：本机数据库里的上下文是服务端公钥加密的，要等抓包（[09](09-runtime-capture.md)）才能看到真实内容。

## 上下文的完整结构

`collectFullContext` 返回的对象，也就是发给服务端的 `audio_context`：

```
audio_context
├── device_environment            系统信息（字段未展开）
├── active_application
│   ├── app_name                  应用名
│   ├── app_identifier            bundle id
│   ├── window_title              窗口标题
│   ├── window_position           窗口位置和大小
│   ├── app_type                  web_browser | native_app
│   ├── app_metadata              进程号、应用路径、窗口号
│   ├── visible_screen_content    窗口内可见文字 ★
│   └── browser_context           网页标题、网址、域名
├── text_insertion_point
│   ├── input_area_type           输入区类型
│   ├── accessibility_role        辅助功能角色（如 AXTextArea）
│   ├── position_on_screen        输入框位置
│   ├── input_capabilities        是否可编辑、是否支持 Markdown、DOM id、DOM class 列表
│   ├── cursor_state
│   │   ├── cursor_position
│   │   ├── has_text_selected / selected_text    选中的文字
│   │   ├── text_before_cursor                   光标前的文字
│   │   ├── text_after_cursor                    光标后的文字
│   │   └── full_field_content                   前 + 选中 + 后
│   └── surrounding_context       输入框之前/之后的内容 ★
└── context_metadata              采集版本、时间、耗时、是否被黑名单拦截、各项采集质量
```

带 ★ 的两项受黑名单控制。

## 什么时候采

| 时机 | 采什么 | 去向 |
| --- | --- | --- |
| **常驻轮询**，每 1 秒 | 应用信息 + 输入框基本信息。默认不带光标文字、不带可见文字、不带周围内容 | 留在内存；用于修改跟踪和判断当前应用 |
| **开始录音** | 应用、输入框、光标状态（含前后文字和选中文字） | 作为会话初值 |
| **录音过程中** | 上一项 + 可见文字（上限 10000）+ 周围内容（前后各 1000），各 500 ms 超时 | 加密后经 WebSocket `replace_audio_context` 发给服务端 |
| **插入文字之后** | 同上一项的完整采集一次，之后每秒读一次输入框全文，最长约 15 秒 | 结束时发 `/user/traits` |
| **"问任何事"模式且没选中文字** | 额外尝试模拟 ⌘C 取选区 | 作为 `selected_text` |

10000 和 1000 这两个数是传给原生库的参数，从函数签名 `getFocusedVisibleTextAsync(int32, int32, 回调)`、`getFocusedElementRelatedContentAsync(int32, int32, int32, 回调)` 和原生函数名里的 `targetChars`、`maxLength` 看，单位是字符数（推断）。

常驻轮询从应用就绪起就开着（`intervalTime = 1000`），与是否在听写无关。轮询的参数可由渲染层通过 `focused-context:set-last-focused-info-timer` 修改；目前看到的唯一修改者是修改跟踪。

## 黑名单

内置一份配置（版本 1.0.3，readable:main/index.js:3670-3704），启动后还会从 `/app/get_blacklist_domain` 拉新的：

| 类别 | macOS 上的内容 |
| --- | --- |
| 应用黑名单 | Sublime Text 4、微信、Excel、WPS、Zed |
| 应用白名单 | Cursor、Slack、Apple 邮件、Figma、ChatGPT Atlas、Conductor、WezTerm、Thunderbird、LINE |
| 网址黑名单（前缀） | `https://docs.google.com/document/d`、`https://docs.qq.com/doc/`、`https://docs.qq.com/sheet/` |
| 网址白名单（前缀） | `https://www.figma.com/design/` |

Windows 端的黑名单长得多（终端、Office、Zoom、WhatsApp、JetBrains 等 30 项）。

**黑名单挡的范围**。`collectFullContext` 先算 `isTextCaptureBlockedByBlacklist`，再把结果传给两个采集函数：

- `collectFocusedAppInfo`：被拦截时跳过 `getFocusedVisibleTextAsync`，即不采可见文字。
- `collectFocusedInputInfo`：被拦截时跳过 `getFocusedElementRelatedContentAsync`，即不采输入框周围内容。但 `getCurrentInputState`（光标前后文字、选中文字）的调用条件里**没有**黑名单这一项。

所以从代码看，在微信里听写时，聊天窗口里别人的消息（可见文字）不会被采，但你正在输入的那一框文字会。这一条待抓包确认。黑名单的判断依据从列表内容推测更像"这些应用里读辅助功能树又慢又不准"，而不是隐私分级——微信和 Excel 在黑名单，Slack 和邮件在白名单。白名单的作用没有读到。

查黑名单出错时按"已拦截"处理。

另有两处特判：自家窗口不采；Notion 网页版的 `AXWebArea` 角色下把光标前后文字清空。

## 插入后的修改跟踪

类 `Bm`（readable:main/index.js:17222-17480）。流程：

1. 文字贴进去后，渲染层调 `track-edit-text:start-track`，传入成品文字和模式。
2. 主进程做一次完整上下文采集。只有当输入框可编辑、且框里确实能找到刚贴的文字时才开始跟踪。
3. 记下"贴入前"的状态：`text_before_cursor`（去掉贴入的部分）、`text_after_cursor`、`full_field_content`。
4. 把常驻轮询切到"带光标文字"模式，同时监听按键事件。
5. 以下任一情况结束跟踪并上报：
   - 焦点换了输入框（`switch_input_box`）
   - 输入框被清空（`clear_input_box`）
   - 改动较大且刚按过回车（`press_enter`，推断对应"发送了消息"）
   - 15 秒内没有新的编辑（`track_timeout`；每次检测到编辑会重新计时）
6. 上报 `POST /user/traits`，内容（信封加密）：

   ```
   refined_inserted_text     它给的文字
   original_input_box        贴入前：光标前文字、光标后文字、整框内容
   edited_input_box          结束时：整框内容
   active_application        应用信息
   device_environment        设备信息
   mode
   ```

7. 回包里如果有 `auto_add_dictionary`，主界面会弹"已自动加入词典"的提示。

这是它"越用越准"的机制：拿你的手动修正去对比它的输出，自动沉淀成个人词典。代价是那 15 秒里输入框的全部内容（包括你接着手打的东西）会离开本机。

改动较大但没按回车时不上报，只在本地写一条 `tracking_edit.log`，里面有当时的整框内容和最近的按键。本机 `Logs/` 目录是空的，这类日志是否默认落盘没有确认。

## 全局按键

键盘子进程用事件监听拿到全系统的按键按下、抬起和修饰键变化（见 [07](07-native-helpers.md)）。每次变化都会把"当前按住的全部键"传回主进程，再广播给四个窗口，普通字母键也在其中。

已确认的用途有三个：匹配快捷键；修改跟踪时判断"用户在编辑"和"用户按了回车"；悬浮条里统计你最近 60 秒在输入框里敲了多少键，超过 60 个就提示一次。细节见 [10](10-interaction-state-machine.md#按键事件怎么走)。

这三处都只在内存里用，没有看到写盘或上传。主界面的大包里还有一处订阅没有读，所以结论是"读过的地方没有"，不是"绝对没有"。

## 存在本机的

- 每条听写的音频：`Recordings/<id>.ogg`，按"历史保留时长"设置清理。
- 每条听写的上下文：`typeless.db` 里，RSA 信封密文，本机解不开。
- 成品文字：`typeless.db`，明文。

详见 [08](08-local-data.md)。

## 设备标识

`libUtilHelper` 生成一个 UUID 作为设备 ID，存在钥匙串里，另有一份本地缓存，两边互相修复（原生库字符串：`Keychain self-healing…`、`Both Keychain and cache are missing, generating new Device ID`）。这个 ID 进每个请求的签名头（`d` 字段）。钥匙串条目不随应用卸载删除，所以卸载重装后设备 ID 应该不变（推断，未验证）。
