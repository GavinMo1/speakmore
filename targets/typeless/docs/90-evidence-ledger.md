# 90 证据台账

每条结论对应的证据来源。

- `ev_…`：REA 返回的 Evidence ID。MCP 会话的完整记录导出在 `_work/evidence/session-01.json`，命令行产生的在 `_work/evidence/native/`，都不进仓库。
- `readable:文件:行号`：去混淆后的可读树 `_work/readable/dist/` 里的位置。行号由 REA 的分析图给出，或经其定位后阅读。可读树是派生产物，重新生成后行号可能变。
- `本机数据`：对 `~/Library/Application Support/Typeless/` 的只读查询。

证据等级：**观察**＝直接从发行包字节或本机数据读到；**推断**＝由观察推出、未经运行验证；**未知**＝尚无证据。

## 目标身份

| 项 | 值 | 来源 |
| --- | --- | --- |
| 应用 | Typeless 2.8.1（build 2.8.1.130），`now.typeless.desktop` | `ev_2ade80387624…` |
| 主程序 | `Contents/MacOS/Typeless`，arm64，sha256 `39977d69502d05a858f9e8df567b724f5bd769f6f965f8615042f86df3d07123` | open_binary |
| `app.asar` | 文件 sha256 `eb9bcc842478b12a7488d90778ad6b08e6788c8fa5e875782ec2af0387c6c80b`；Info.plist 登记的头部哈希 `a929537840b9…b517fc` | shasum；`ev_2ade80387624…` |
| 原件 `dist/` | 目录摘要 `02ac78addb80…daec8bd` | `ev_746a49c31792…` |
| 可读树 `dist/` | 目录摘要 `b86c4f96d298…2e8a50` | `ev_675220c1fc7d…` |

## REA 记录索引

### JS 与包（MCP 会话）

| Evidence ID | 操作 | 对象 |
| --- | --- | --- |
| `ev_746a49c31792850a11d22af3660a9ecf82f5e8e551fc0588ab6af5daffcd8641` | analyze_javascript_application | 原件 `dist/`（混淆） |
| `ev_9aabf8d385f1891885daedc3b3087587d01028968e628d4570c6b5e2304f9326` | inspect_analysis_view（摘要） | 同上 |
| `ev_675220c1fc7dd61b2392f7eb22389d90bbf8208c787a52c20d25d23687d50bb1` | analyze_javascript_application | 可读树 `dist/` |
| `ev_2c4ab4370c37ff7d5b2cb68424926154aea3916de3886baf93a1a0deb588cfe3` | inspect_analysis_view（摘要） | 同上 |
| `ev_2ade80387624432c0b0686ccbbf429b8611de1129c683c7832b1b4ca0c45e55a` | inspect_plist | `Info.plist` |
| `ev_c38e740933e3b271fb69e066f49d90a6f3df00d80f3c0857f1c85fbfe82401b4` | inspect_signature | 主程序 |
| `ev_7c03de934ec9abea2f3aa40d49042654ce2def9f3ffbd7eadea895fdbd8b9aa1` | inspect_plist | `build/entitlements.mac.plist` |

### 原生库（命令行，Ghidra 12.1.4）

| Evidence ID | 操作 | 对象 |
| --- | --- | --- |
| `ev_b0061cae407510bc2ef9d5c1b87da61c068d4fe545087b1ebb99b941b9279330` | inspect-macho | libContextHelper（原库） |
| `ev_16cad01399e291e3e06e66790d1fd157f7e155c45530de4d2073b07311bfdc46` | inspect-macho | libInputHelper（原库） |
| `ev_d72a2a93e6e6bf2e5f20fd61198605fe28422094cf4428c43979364a7a5e4dcc` | inspect-macho | libKeyboardHelper（原库） |
| `ev_52a412e6963a033e9f589c80317d2097feaf8885ff2d1896cafa7594ff24ff2e` | inspect-macho | libUtilHelper（原库） |
| `ev_7e744c7969bd3c7182b74f0742b31fe8b9cbef09a71c32454f21158dc71d8361` | function | libInputHelper arm64 切片 `_insertText` |
| `ev_de5df527a4d81a4310ceba1be2ada63c9a7d63778e99651f002ed1ee8108ddcc` | function | 同上 `performTextInsertion(with:)` |
| `ev_f14d43e1507e6ccd0f0c84af2c967f2bcf4f8a70ab4972258f89abfa25e577f2` | function | 同上 `simulatePasteCommand(completion:)` |
| `ev_2570dafef3e37ae0a578dae4e5b82e25bdbec5f87433ac681b57ffe3fa03c507` | function | libKeyboardHelper arm64 切片 `KeyboardMonitor.startMonitor` |
| `ev_003da589071155754b6f277fd1190ed8ae95e044be4bda870508d8a82db50c78` | search | libContextHelper 切片：浏览器标识、AX 属性名 |
| `ev_e73d124b0e44cd20541a30ac3e8d35d3df60d6fbb7ea32db11c47501052ee9c9` | search | libUtilHelper 切片：设备 ID、合盖状态 |
| `ev_e39480b286e993667249d23b4651592bf541adf1e0f9d885ade69affe834a31b` | search | libInputHelper 切片：文本读取相关 |
| `ev_96cc9a8e94f47140e687a4a2ece2e69894f576737b016489e2326c9906b08bbe` | search | libKeyboardHelper 切片：类名 |

arm64 切片的 sha256 前 16 位：Context `1ec75d0d3fc5845c`、Input `f28cd2211ddee2ba`、Keyboard `5c2e97d536311e8e`、Util `8a28ad793915931c`。

## 结论

| # | 结论 | 等级 | 证据 |
| --- | --- | --- | --- |
| F01 | 主进程、预加载、worker 和 17 个渲染层文件被 javascript-obfuscator 混淆；主进程 2843 条字符串 | 观察 | webcrack 日志；两次 REA 分析的通道数 8 → 112 |
| F02 | API 主机写死为 `https://api.typeless.com`，环境 `prod` | 观察 | readable:main/index.js:52-59 |
| F03 | 请求签名：`X-Authorization` = 口令式 AES( JSON{…, t, p, d} )，`p` = HMAC-SHA1(`t:版本:路径:用户ID`, `t:盐`)，口令和盐写死在包里 | 观察 | readable:main/index.js:3195-3247、2475-2477 |
| F04 | 登录态请求带 `Authorization: Bearer` | 观察 | readable:main/index.js:3300-3342 |
| F05 | 418 + `ja3_tls_code == 101010101` 时用响应头 `Date` 校正时间差 | 观察 | readable:main/index.js:3409-3417 |
| F06 | `POST /ai/voice_flow` 的字段与回包 | 观察 | readable:main/index.js:17817-17935；REA 端点节点 → 17903 |
| F07 | 上下文信封：RSA-OAEP-SHA256 包 AES-256-GCM 密钥，IV 全零，公钥来自 `/user/get_user_info` | 观察 | readable:main/index.js:3780-3909 |
| F08 | WebSocket `/ws/rt_voice_flow` 的收发消息类型；结束后与 HTTP 赛跑 | 观察 | readable:UfR9-a2Z.js:10755-10800、11142-11560 |
| F09 | 内置黑白名单（版本 1.0.3）及其内容 | 观察 | readable:main/index.js:3670-3704 |
| F10 | HTTP 客户端的 `proxyUrl`：undici 代理且关证书校验 | 观察 | readable:main/index.js:3452-3474、3561 |
| F11 | `audio_context` 的字段结构 | 观察 | readable:main/index.js:11440-11770 |
| F12 | 每 1 秒的常驻焦点轮询，默认不带文字内容 | 观察 | readable:main/index.js:11340-11405 |
| F13 | 听写时上下文分两次取：开始时轻量，录音中补可见文字 10000 / 周围 1000+1000，超时 500 ms | 观察 | readable:qA149QP2.mjs:5768-5772、5856-5868 |
| F14 | 黑名单只跳过可见文字和周围内容，不影响光标前后文字 | 推断（待抓包） | readable:main/index.js:11468（可见文字）、11546（光标文字，无黑名单条件）、11563（周围内容）、11711（黑名单判定） |
| F15 | 插入后修改跟踪：最长约 15 秒、每秒读输入框全文、结束时发 `/user/traits` | 观察（代码）；实际上报内容待抓包 | readable:main/index.js:17222-17480 |
| F16 | 插入文字 = 存剪贴板 → 写入带临时标记的条目 → 模拟粘贴 → 恢复 | 观察 | `ev_de5df527a4d8…`、`ev_f14d43e1507e…`、`ev_16cad01399e2…` |
| F17 | 全局按键用 `CGEventTapCreate(HID 层, 头部插入, 主动式, 掩码 0x6001c00)`，在子进程里 | 观察 | `ev_2570dafef3e3…`；readable:main/index.js:12038 |
| F18 | 读上下文全靠辅助功能接口，对焦点应用设 `AXEnhancedUserInterface` | 观察（API 与字符串）；流程为推断 | `ev_b0061cae4075…`、`ev_003da5890711…` |
| F19 | 设备 ID 是自生成的 UUID，存钥匙串并有本地缓存互相修复 | 观察（字符串与 API） | `ev_e73d124b0e44…`、`ev_52a412e6963a…` |
| F20 | 开发开关 `__DEV_API_HOST` 在正式版里生效，主进程与渲染层都读 | 观察 | readable:main/index.js:10134-10152；UfR9-a2Z.js:7435 |
| F21 | 窗口会话设为直连，不走系统代理 | 观察 | readable:main/index.js:4578-4581 |
| F22 | 预加载把 `ipcRenderer.invoke` 原样暴露给页面，无通道白名单 | 观察 | readable:preload/index.mjs:69-91；REA 图 context-bridge-api ×3 |
| F23 | 签名：Simply LLC (947QKAND4W)，hardened runtime，4 项 entitlement | 观察 | `ev_c38e740933e3…` |
| F24 | fuses：允许 `--inspect` 与 `NODE_OPTIONS`，asar 完整性校验开启 | 观察 | 自写脚本读 Electron Framework 的 fuse 区（非 REA） |
| F25 | 本机 3120 条记录的 `audio_context` 全是 RSA 信封；`debug_info` 是服务端密钥加密，包内常量解不开 | 观察 | 本机数据；openssl 试解失败 |
| F26 | 音频参数：Opus/Ogg、16 kHz、单声道、32 kbps VBR、3 秒一块 | 观察 | 本机数据（最新记录 `audio_metadata`）；readable:qA149QP2.mjs:6426-6436 |
| F27 | 模式映射：`voice_transcript`→`transcript`、`voice_command`→`ask_anything`、`voice_translation`→`translation` | 观察 | readable:main/index.js:6879-6881、17211-17215 |
| F28 | 经本机 mitmproxy 反向代理转发的免登录请求能得到服务端正常回包 | 观察 | 2026-10-12 自测：`GET /app/get_blacklist_domain` → 405 |

## 工具与限制

- **REA 6.4.0** 是主干。MCP 会话没有配置 Ghidra 路径，原生库分析走的是 REA 命令行（`GHIDRA_INSTALL_DIR` 指向 `.tools/ghidra_12.1.4_PUBLIC`）。
- REA 的 Ghidra 引擎不接受多架构合一的 Mach-O，需先 `lipo -thin`。
- REA 的端点识别把 electron-store 的 `.get("键")` 误归为 network 端点。
- REA 的 `recover_javascript_sources` 仅支持 Linux x64，去混淆用了 **webcrack 2.16.0**。
- Ghidra 官方包不带 macOS 原生反编译器，用它自带的 `support/gradle/gradlew buildNatives` 在本机编了一份（安装包 sha256 已与官方发布值核对一致）。
- 没有用 REA 完成的两处：fuse 读取、本机数据库查询。
