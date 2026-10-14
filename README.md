<p align="center">
  <img src="assets/icon.svg" width="128" height="128" alt="SpeakMore 的图标：靛青底的一方印，刻着五道声波" />
</p>

<h1 align="center">SpeakMore</h1>

<p align="center">
  按一下热键说话，再按一下，整理好的文字就贴进你正在用的输入框。<br>
  macOS 上的开源语音输入，用你自己的 Gemini 或 OpenAI 的 API key。
</p>

口头禅、改口、重复会被整理掉，长一点的话会分段、分点。只做语音转写这一件事：不采集屏幕和输入框里的内容，没有账号，没有云同步。

名字和 Typeless 反着来：它是照着对 Typeless 的[逆向分析](targets/typeless/README.md)做的独立实现，和 Typeless 官方没有关系。

## 装和用

需要 macOS 12 以上，和一把 Gemini 或 OpenAI 的 API key（[Gemini 的在这申请](https://aistudio.google.com/apikey)，[OpenAI 的在这申请](https://platform.openai.com/api-keys)，两家的区别见[换模型](#换模型)）。别的都不用装：不需要 Node、npm，也不需要 sudo。

```bash
curl -fsSL https://dl.zephyrxiang.com/speakmore/install.sh | bash
```

这一行做三件事：

1. **预检查**：系统版本、芯片、磁盘空间、下载地址连不连得上，以及 Gemini、OpenAI 各自连不连得上（连不上只提醒，不拦着）。哪一项不行会说清楚原因和怎么办，不行就什么都不装。
2. **安装**：下载、核对校验值，把程序和它自带的运行环境放进 `~/.speakmore`，在 `~/.local/bin` 建一个 `speakmore` 命令。
3. **启动**：在终端里先问你用哪一家的模型（Gemini 或 OpenAI，直接回车是 Gemini），再要那一家的 key（粘贴后回车，输入不会显示出来），系统弹出麦克风授权框时点“允许”，然后显示状态。还缺系统权限的话会顺手打开设置窗口，每一项旁边有去系统设置的按钮。

看到下面这样就可以用了：点进任意输入框，按一下右 Option，说话，再按一下。

```text
SpeakMore 0.4.2 · 运行中

  可以用了：点进任意输入框，按一下右 Option 键开始说话，再按一下结束，文字会贴进去。

  key       已保存，验证通过
  权限      麦克风 ✓   输入监控 ✓   辅助功能 ✓
  热键      右 Option 键
  模型      Gemini 的 gemini-3.5-flash（MINIMAL）
  主题      墨（ink）
  今天      12 次 · 1,024 字 · 3 分 20 秒
  累计      132 次 · 12,480 字 · 48 分钟 · 每分钟 260 字
```

说话的时候屏幕下方有一条悬浮条：中间的声波跟着你的声音从正中间往两边跳，上方一行字写着现在按哪个键。说完再按一下热键，或者点右边的 ✓；不想要这一次了按 `esc`，或者点左边的 ✕。文字贴出去之后它打个勾就消失。

它在后台运行，关掉终端窗口也还在，菜单栏上有它的图标（五道竖线，和上面那方印上刻的一样），点开是设置、历史记录和退出。电脑重启后要再运行一次 `speakmore`。

找不到菜单栏上的图标：带刘海的 MacBook 上，右边的图标一多，排在最左边的会被刘海挡住，系统直接把它藏起来。按住 ⌘ 把几个不常用的图标拖出菜单栏就能露出来；不找它也行，`speakmore settings` 打开设置窗口，`speakmore history` 看历史。

**升级**：把安装那一行再运行一次。程序换成新的，设置、key、历史和录音不动。

**卸载**：`speakmore uninstall`。它停掉后台，把 `~/.speakmore`、那个命令链接、钥匙串里的那一条一起删掉。只想删程序、留下自己的东西，加 `--keep-data`。

## 命令

| 命令 | 做什么 |
| --- | --- |
| `speakmore` | 启动。已经在运行就只显示状态；没有 key 时问你要 |
| `speakmore stop` / `restart` | 停掉 / 重启。它卡住不答话时也停得掉 |
| `speakmore status [--json]` | 在不在运行、key、三项权限、今天和累计说了多少。能用时退出码是 0 |
| `speakmore history [-n 条数] [--json]` | 看说过的话，按天分组，新的在前。失败的那条会写原因，录音还留着 |
| `speakmore model` | 看能用哪几家的模型、各家的 key 有没有、现在用的哪个。见[换模型](#换模型) |
| `speakmore model <厂商>[/<模型>]` | 换一家或换个模型，正在运行的话自动重启。还没有那一家的 key 会先问 |
| `speakmore model check [<厂商>[/<模型>]]` | 检查能不能用：拿那一家的 key 发一个最小的请求，说能不能用、来回多久。不写就查现在用的 |
| `speakmore key [<厂商>]` | 换一把 key，不写厂商就是现在用的那家。也可以从管道喂：`pbpaste \| speakmore key`。别把 key 写在命令后面，那样会进 shell 的历史记录 |
| `speakmore key --forget [<厂商>]` | 删掉存着的 key |
| `speakmore config` | 看设置，以及东西都放在哪 |
| `speakmore config set <名字> <值>` | 改一项设置，正在运行的话自动重启，并告诉你新的值能不能用。`unset` 回到默认 |
| `speakmore theme [名字]` | 不带名字：看有哪几套主题、现在用的哪套。带名字：换一套，当场生效，不用重启 |
| `speakmore settings` | 打开设置窗口（去系统设置授权时用） |
| `speakmore logs [-n 行数] [-f]` | 看日志 |
| `speakmore uninstall [--keep-data]` | 卸载。先说清楚要删什么，问一句再动手 |

## 三项系统权限

| 权限 | 用来做什么 | 没有时的表现 |
| --- | --- | --- |
| 麦克风 | 录音 | 按热键时屏幕下方提示没有麦克风权限 |
| 输入监控 | 听热键。只认你选的那一个键，别的按键不记录 | 热键没反应，`speakmore status` 里标出来 |
| 辅助功能 | 模拟 ⌘V 把文字贴进去；说话时把 `esc` 和悬浮条上的点击截下来，不让它们落到你正在用的应用上 | 照样能用，文字放进剪贴板，自己按 ⌘V；悬浮条上没有 ✕ 和 ✓，`esc` 也取消不了 |

用 `speakmore` 命令启动时，这三项权限**记在你运行命令的那个终端程序名下**（“终端”、iTerm、Ghostty 等），在系统设置的列表里要找的是它，不是 SpeakMore。换一个终端程序启动，就要给那个终端再授权一次。

在系统设置里打开开关之后，运行 `speakmore status`，它会重新检查一遍。

## 设置

```bash
speakmore config set hotkey fn        # 换热键
speakmore config unset hotkey         # 回到默认
```

| 名字 | 默认值 | 能填什么 |
| --- | --- | --- |
| `hotkey` | `right_option` | `right_option` / `right_command` / `right_control` / `fn`，都是单独按一下。Typeless 用的是 `fn`，默认避开它，两个可以同时开着 |
| `model` | `gemini/gemini-3.5-flash` | `厂商/模型`，只写厂商就用它的默认模型。用 `speakmore model` 换更方便，见下面 |
| `thinking` | `MINIMAL` | `MINIMAL` / `LOW` / `MEDIUM` / `HIGH`，越高越慢。只有 Gemini 用得上，有的 Gemini 模型不接受 `MINIMAL` |
| `theme` | `ink` | 界面的主题，见下面 |

设置存在 `~/.speakmore/settings.json` 里。只想临时换一次，可以用环境变量 `SPEAKMORE_HOTKEY`、`SPEAKMORE_MODEL`、`GEMINI_THINKING_LEVEL`、`SPEAKMORE_THEME`，它们优先于文件。0.3 的 `GEMINI_MODEL`（只能写 Gemini 的模型名）还认，两个都设着时 `SPEAKMORE_MODEL` 优先。key 也一样：`GEMINI_API_KEY`、`OPENAI_API_KEY` 设着的话，用到那一家时用它，不读存着的那把。

环境变量要写在**启动它的那条命令**上才算数。SpeakMore 已经在运行时，先 `speakmore stop`，再带着环境变量运行 `speakmore`。状态面板上的热键和模型，写的是正在运行的那个实际在用的。

带着 `GEMINI_API_KEY` 运行时再执行 `speakmore key`，新的那把会存下来并立刻换上；但只要环境变量还在，下次启动用的仍是环境变量里的那把。

### 换模型

默认用 Gemini，第一次启动时可以直接选 OpenAI。之后要换，在设置窗口的"用哪家的模型"里点那一家：已经有它的 key 就点"改用"，没有就在下面粘贴一把，验证过当场换过去，不用重启。命令行也行：

```bash
speakmore model                          # 有哪几家、各用哪个模型、key 有没有、现在用的哪个
speakmore model openai                   # 换成 OpenAI（默认 gpt-audio-mini）。还没有它的 key 会先问
speakmore model openai/gpt-audio-1.5     # 指定模型
speakmore model check                    # 现在用的这个能不能用；也可以查别的：speakmore model check openai
speakmore key openai                     # 只给 OpenAI 存一把 key，不换过去
speakmore model gemini                   # 换回来
```

| 厂商 | 默认模型 | key 去哪申请 | 说明 |
| --- | --- | --- | --- |
| `gemini`（默认） | `gemini-3.5-flash` | [Google AI Studio](https://aistudio.google.com/apikey) | 录音原样发过去。提示词是对着它调的，整理得最干净，一般 2 秒左右出成品 |
| `openai` | `gpt-audio-mini` | [OpenAI 开发者平台](https://platform.openai.com/api-keys) | 它只收 WAV 和 MP3，录音先在本机转成 16 kHz 的 WAV 再发（一分钟的录音转一次约 60 毫秒）。实测 2–5 秒出成品，口头禅删得没有 Gemini 干净。转出来的 WAV 比原录音大七八倍，长录音慢：悬浮条最多等成品 20 秒，按 90 秒的录音要 6–9 秒推算，三分钟以上的可能等不到（没实测；录音留着）。`gpt-audio-1.5` 有时把成品包成 `{"…"}` 的样子，不建议用 |

每家的 key 各存一份，来回换不用重新填。用命令换模型要重启后台，`speakmore model` 会替你重启；设置窗口里换的只换厂商、用它的默认模型，要指定模型还是用命令。要退回 0.3：先 `speakmore model gemini` 换回 Gemini，0.3 认得这样存下的设置。

### 主题

悬浮条、设置窗口、历史窗口的颜色是一套主题。现在有三套：

| 名字 | 样子 |
| --- | --- |
| `ink` 墨（默认） | 黑白。状态靠形状和动作来说，只有出错才出现颜色 |
| `cinnabar` 朱砂 | 一种暖红，用在声波和最主要的按钮上 |
| `indigo` 靛青 | 颜色代表阶段：绿是在听，蓝紫是在整理，琥珀是出了问题。0.2 版就是这一套 |

```bash
speakmore theme               # 列出来；终端支持 24 位色的话，每套会用它自己的颜色画一小段悬浮条
speakmore theme cinnabar      # 换一套，写中文名也行：speakmore theme 朱砂
```

换主题不用重启，开着的窗口当场变。悬浮条浮在别的应用上面，所以三套都是深色底；两个窗口跟随系统的浅色深色。

## 出了状况

| 看到的 | 怎么办 |
| --- | --- |
| 面板上 key 那一行写着“还没验证” | 启动时没连上 Gemini，存着的 key 先用着。连上网后再运行一次 `speakmore status` |
| “还差：Gemini 验证”（或 OpenAI 验证） | 那一家拒绝了请求，多半是模型名或思考档位不对，key 未必有问题。`speakmore model check` 看它怎么说，`speakmore config unset model` 回到默认 |
| “还差：按键监听” | 听热键的小程序停了。`speakmore restart`，还不行就看 `speakmore logs` |
| 命令说它“没有在 5 秒内回话” | 后台卡住了。`speakmore stop` 会强行结束它，再运行 `speakmore` |

## 都放在哪

**发出去的只有录音**，直接发给你选的那一家（Google 的 Gemini 或 OpenAI）的接口，用的是你自己的 key。没有别的服务器，没有统计上报，也不读屏幕和输入框里的内容。

留在本机的全在 `~/.speakmore/` 这一个目录里，只有你自己进得去：

| 里面的东西 | 说明 |
| --- | --- |
| `settings.json` | 上面那几项设置 |
| `gemini-key.bin`、`openai-key.bin` | 加密后的 key，每家一个。解密用的密钥在系统钥匙串的“SpeakMore Safe Storage”里，文件被拷走也解不开 |
| `data/history.db`、`data/Recordings/` | 说过的话和录音。失败的听写也存录音，话不会白说 |
| `logs/main.log` | 日志，一行一条 JSON。只记长度和耗时，不记说的话，也不记 key |
| `run/`、`cache/` | 运行时产生的：命令和后台之间的通道、进程号、运行环境自己的缓存。删了会自己再建 |
| `bin/`、`app/`、`runtime/` | 程序本身：`speakmore` 命令、代码和依赖、自带的运行环境（Electron）。升级时整个换掉 |

目录以外只有三样东西：

- `~/.local/bin/speakmore`，一个指向 `~/.speakmore/bin/speakmore` 的链接。
- 钥匙串里的“SpeakMore Safe Storage”，加密 key 用的。
- 你给终端的三项系统权限。

`speakmore uninstall` 会删掉前两样和整个目录。系统权限记在终端名下，要你自己去系统设置里关。

想装到别处，安装时设环境变量 `SPEAKMORE_HOME`，装好的命令会记住这个位置。0.1 版把数据放在 `~/Library/Application Support/SpeakMore`，装上这一版后第一次运行会自动搬过来。

## 它是怎么来的

先对 Typeless 的 macOS 客户端做了一遍逆向：拆安装包、读还原出来的代码、看本机数据、抓自己账号的流量，弄清楚它为什么快、发了什么出去、文字是怎么贴进输入框的。结论写成了 [targets/typeless/docs/](targets/typeless/docs/00-overview.md) 下的文档，出处记在[证据台账](targets/typeless/docs/90-evidence-ledger.md)里。

然后照着文档里的协议和交互重新写了一个，只保留语音转写：服务端换成自己的（一次模型调用完成识别和整理，默认 Gemini，也可以换 OpenAI），不采集屏幕和输入框内容，不需要账号。仓库里不含 Typeless 的代码和密钥。

## 现在的不足

和 Typeless 比：

- **专有名词和人名会听错。** Typeless 会把当前应用和屏幕上的文字一起上传当上下文，这里只有录音，也还没有个人词典。
- **列表用得比它少**，口吃偶尔删不干净（约每 60 条 1 条）。
- **换成 OpenAI 时整理得比 Gemini 粗。** 提示词是对着 Gemini 调的，还没拿真实录音对 OpenAI 调过。
- **话说到一半就按停，模型可能自己把后半句补上。** 实测过一次：录音在“大家记得”处被截断，成品里多出了没说过的“准时参加”；同一段话录完整时成品是对的。还没有针对它调提示词。
- 只有听写，没有翻译和“问任何事”。

还没做的：

- 登录时自动启动。现在重启电脑后要再运行一次 `speakmore`。
- 失败的听写重试。录音留着，但还不能一键重新整理。
- 图形界面的主窗口，以后在现有的 Electron 后台上加（原版 Typeless 也是 Electron）。现在的入口是命令行，加一个菜单栏图标、设置窗口和历史窗口。换主题现在也只能用命令，设置窗口里还没有。
- 悬浮条固定在主屏幕的底部，不会跟着鼠标换到另一块屏幕上。
- 等成品的那一两秒取消不了：录音已经交出去了。
- Windows 和 Linux。

## 开发

从源码跑需要 Node 22.13 以上（用 23 的话要 23.4 以上）和 Xcode 命令行工具（`xcode-select --install`）：

```bash
git clone https://github.com/zephyr4123/speakmore.git
cd speakmore
npm install
npm start                     # 就是 speakmore；子命令写在 -- 后面，比如 npm start -- status
npm run check                 # 代码检查 + 全部测试（420 条，不联网、不开窗口）
npm run release               # 打发布包：dist/release/ 下两种芯片各一个，外加 install.sh，摆成下载地址上的样子
```

**发布新版本**：改 `package.json` 里的版本号并提交，打一个同名的标签推上去（比如 `git tag -a v0.4.1 -m "…" && git push origin main v0.4.1`），然后在本机运行 `npm run ship`。它先核对工作区干净、当前提交就是那个标签、标签已经推上去，再跑全部检查、打包，传到下载地址 `dl.zephyrxiang.com/speakmore/`（腾讯云 COS + CDN），最后从下载地址核对版本号和校验值。桶和密钥从哪来写在 `.machine.env` 里。发布包只放在 COS 这一处；发布过的版本号不会被覆盖，要改就升版本号。传到一半断了，不要重新打包，再运行一次 `scripts/release/with-cos-key.sh npm run publish-release`，传好的会跳过。

从源码跑的和装好的用的是同一个 `~/.speakmore`，想分开就设 `SPEAKMORE_HOME`。

要真调模型的命令需要环境里有那一家的 key（`GEMINI_API_KEY`、`OPENAI_API_KEY`）。`scripts/dev/with-key.sh <厂商>` 可以按你自己机器上的配置把它只喂给一条命令，见 `.machine.env.example`。用哪家哪个模型由 `SPEAKMORE_MODEL` 定，默认 Gemini：

```bash
scripts/dev/with-key.sh gemini node scripts/dev/e2e.mjs 一段录音.wav   # 端到端：真的 Electron、录音编码、模型；麦克风和贴字是假的
SPEAKMORE_MODEL=openai scripts/dev/with-key.sh openai node scripts/dev/e2e.mjs 一段录音.wav   # 同上，换成 OpenAI
scripts/dev/with-key.sh gemini node scripts/dev/eval-prompt.mjs --label v1   # 拿自己 Typeless 的历史录音评估提示词
scripts/dev/with-key.sh gemini node src/server/main.mjs           # 单独启动听写服务，配合 SPEAKMORE_SERVER_URL 调试
node scripts/dev/replay.mjs 块1.ogg 块2.ogg                         # 把现成的录音发给单独启动的服务
```

加一家模型：在 `src/server/providers/` 下写一个适配器（请求怎么拼、收哪些录音格式、报错怎么认），在同目录的 `index.mjs` 里登记一行。整理流程（提示词、收尾、重试、转格式）各家共用，在 `src/server/refine/`。

不发布也可以试安装脚本：`SPEAKMORE_INSTALL_BASE=$PWD/dist/release SPEAKMORE_HOME=/tmp/sm bash install.sh`，装进一个临时目录。

| 目录 | 内容 |
| --- | --- |
| `install.sh` | 安装脚本：预检查、下载、校验、装进 `~/.speakmore`、启动 |
| `bin/`、`src/cli/` | `speakmore` 命令 |
| `src/app/` | 后台应用的主进程（Electron）：悬浮条、菜单栏、设置和历史窗口；`keys/` 是 key 的保存和启用 |
| `src/renderer/`、`src/preload/` | 各个窗口的页面，一个窗口一个目录：`bar/`（悬浮条：状态机、录音、听写协议的客户端、画面）、`history/`、`settings/`，共用的样式在 `shared/` |
| `src/themes/` | 主题：界面要哪些颜色（一组 token）、每套主题给的值、合不合格怎么查。加一套主题是加一个文件、登记一行 |
| `src/server/` | 听写服务：`protocol/` 收分块音频，`refine/` 交给模型整理（各家共用的流程），`providers/` 每家模型一个适配器，`audio/` 把录音转成别家收的格式。平时跑在后台应用的进程里 |
| `native/` | 听热键、贴字、说话时截住 `esc` 和悬浮条上点击的小程序（Swift） |
| `assets/` | 图标：`icon.svg` 是那方印，`tray.svg` 是菜单栏上的五道；`.icns` 和 `trayTemplate*.png` 由 `scripts/build/make-icon.sh` 从它们生成 |
| `src/storage/` | `~/.speakmore` 里的东西：放在哪、设置、历史库、旧数据的迁移。命令和后台应用共用 |
| `src/control.mjs`、`src/log.mjs` | 命令和后台应用之间的控制通道、日志 |
| `test/` | 自动测试，目录和 `src/` 对应 |
| `scripts/` | 开发用的脚本，按用途分四组：`build/` 编译小程序、打 .app；`release/` 发新版本（`ship.sh`：把关、打包、上传、核对）；`dev/` 端到端、评估提示词、回放录音、按本机配置加载 key；`checks/` 核对 GitHub 账号、检查本机信息有没有漏进仓库（配置样板是 `.machine.env.example`） |
| `docs/` | [实现笔记](docs/implementation-notes.md) |
| `targets/typeless/` | 对 Typeless 的[逆向分析](targets/typeless/README.md)，18 篇文档。SpeakMore 是照着它做的 |
| `AGENTS.md`、`.memory/` | 和 AI 编程助手协作时用的工作约定和项目记忆 |
| `.claude/`、`.mcp.json` | 逆向用的工具 [REA](https://github.com/morluto/rea) 的项目级配置。`.claude/skills/` 下是 REA 自带的说明文件，版权归它的作者，MIT 许可 |

和原版的对应关系、模型怎么选的、提示词怎么调的，在[实现笔记](docs/implementation-notes.md)里。

### 打成 .app

装好的 SpeakMore 是从终端启动的，三项权限记在终端名下。想让它们记在“SpeakMore”自己名下、并且能勾选登录时自动启动，可以从源码打成应用：

```bash
npm run install-app     # 打包并装进“应用程序”，然后打开
```

用的是不带身份的本机签名，所以每次重新打包系统都会把它当成一个新应用，权限要重新给，key 要重新填。它不在 `~/.speakmore` 里，`speakmore uninstall` 不会删它。

.app 在运行时，`speakmore status`、`history`、`key`、`stop` 照常能用。`speakmore restart` 和 `config set` 不会代它重启：从命令行起来的是终端启动的那一个，权限和 key 是另一套。按提示从菜单栏退出，再打开一次。

### 验证到哪一步

- 自动测试 427 条，在 Node 26.0 上全过；其中 409 条单测在 Node 24.21（Electron 自带的版本，程序就跑在它上面）上也全过；Node 22.13 上跑过的是更早的 269 条（之后加的没在 22 上重跑）。其中 18 条是安装脚本的，17 条拿假的发布包真的跑安装脚本：全新安装、升级、指定版本、各项预检查不过、校验不过、停不掉、路径里有空格和引号。
- 用真的发布包走过一遍，装在临时目录里，`PATH` 里没有 Node：
  - 安装脚本从管道读入，装完直接启动并问 key，输入不显示。
  - 启动、状态、设置、重启、停止；合成的语音经过录音编码、Gemini、存历史，成品正确。
  - 再装一次（升级），历史还在。
  - `speakmore uninstall` 之后目录、命令链接、后台进程、钥匙串里的那一条都没了。
- Intel 的那一份只在 Apple 芯片的机器上借 Rosetta 跑过（命令、后台、小程序都起得来），**没有在真的 Intel 机器上试过**。
- 上一版在真机上走过的那些路（多行 key 被拒、后台卡住时强行结束、同时启动、模型名写错）这一版重跑了自动测试，没有逐条重走。
- 照上面那一行从真的下载地址装过一遍（0.2.0，装进临时目录，`PATH` 里没有 Node）：下载、校验、安装、`--version`、卸载都正常。
- 0.3.0 发布后同样从真的下载地址装进临时目录核对过（这次 `PATH` 里有 Node，只装不启动）：`--version` 是 0.3.0，`speakmore theme` 列得出三套主题，卸载删干净了。第一次下载中途断了（`curl` 报 HTTP/2 的流没有正常关闭），安装脚本报"下载中断了"、原来的东西没动，再运行一次就装好了。
- 0.4.0 是从本机发的：当时推标签由 GitHub 的机器发布，检查和打包都过了，往 COS 传了 32 分钟，第一个包还没传完，COS 回 "User network is too slow"，什么都没传上去。同一个提交在本机打包、传两个包用了 2 分 15 秒。之后发布改成只从本机发（`npm run ship`），GitHub 上的发布流程删掉了。发布后从真的下载地址装进临时目录核对过（只装不启动）：`--version` 是 0.4.0，图标在包里，音频解码只剩 `decode-webm`、没有 `codec-parser`，卸载删干净了。
- 主题和新的悬浮条（下面这些是从源码跑的；发布包里的只核对了上一条那几项，没有启动过）：
  - 画面：用真的页面和样式离屏截图看过，三套主题下悬浮条的七种样子（浅色、深色背景各一张）、两个窗口（跟随系统的浅色深色各一张）；报给小帮手的按钮位置和页面上画出来的位置差在 1 个像素以内。
  - 截住 `esc` 和点击：给真的小帮手发合成的按键和鼠标事件，下游另挂一个监听看有没有漏。`esc` 和落在划定区域里的点击都被吞掉并报上来，长按 `esc` 时松开的那一下也吞掉，不截的时候监听是关着的。15 项全过。
  - 真的后台应用连着真的小帮手和麦克风走过一遍：换主题当场生效；合成一次热键开始说话，合成 `esc` 取消。说话时和取消后最前面的应用都没变，`esc` 没有漏给它，取消的那次没有进历史。
  - 合成的语音经过新的悬浮条、录音编码、Gemini、存历史，成品正确。
  - 按着真键盘、对着真麦克风、用真鼠标试过一轮：说了三段都贴进了输入框，点 ✓ 完成、点 ✕ 取消各一次都截到了，日志里没有警告和错误。声波的高度是照这三段录音的音量标定的（原来的算法下竖条大多只有两三成高）。
  - 声波后来改成和原版一样原地跳：原来是一排向左流的音量，嫌没有动感；现在每个字从正中间激起一道波传到两边，中间高、两边低，每帧都在抖。拿一段真实录音的 5 秒在真的页面里放过：没有报错，说话时中间那根平均 0.64、最边上 0.22，几乎每帧都在变，只有 2% 的帧顶到满格。**还没有对着真麦克风看过**。
  - 真键盘按 `esc` 取消也试过：截到了，这一次没有进历史，取消之后监听是关着的。
- 换模型（从源码跑的，发布包里还没试过）：
  - 合成的语音经过悬浮条、录音编码、模型、存历史，Gemini 和 OpenAI 各走通一遍；OpenAI 那一遍录音在本机从 WebM 转成 WAV 用了 56 毫秒。
  - 在临时目录里用真的后台和真的 key 走过一遍命令：列模型、查 Gemini、查没有 key 的 OpenAI、从管道给 OpenAI 存 key、查两个 OpenAI 模型（一个能用、一个不存在）、换到 OpenAI 并重启、看状态、没有 Gemini 的 key 时换回去被拦下、删 key。
  - 设置窗口里 key 那一块的说法，用真页面离屏截图核对过两家。
  - 换成策略之后，Gemini 拿同一批 60 条真实录音回归过，和之前两次的数字在同一个波动范围里（见[实现笔记](docs/implementation-notes.md#不止一家模型)）。
- 图标（从源码跑的）：
  - 菜单栏图标在真的 Electron 里读得出来，16 和 32 两种尺寸都在，系统认作随菜单栏深浅反色的那种。在临时目录里起了一个真的后台，菜单栏上它那一项没有文字、宽 34 点（写着"听写"的旧样子是 48 点）；没有截屏亲眼看，因为终端没有录屏权限。
  - 设置和历史窗口顶部的图标和产品名，用真页面离屏截图看过浅色深色。
  - 按发布包的清单实际摆过一遍，`assets/` 在里面。
- 第一次用时选哪家、设置窗口里换一家（从源码跑的，临时目录、右 Control 当热键）：
  - 在伪终端里跑第一次启动：选 2（OpenAI）、粘贴 key，启动后用的是 OpenAI，设置文件里记着它，key 没有出现在屏幕上；选的时候按 Ctrl-C，key 也不问了，照默认的 Gemini 启动，面板里说还差 key。
  - 用调试协议驱动真的设置窗口：两家都有 key 时点"改用 OpenAI"，命令行看到的、设置文件里的都换成了 OpenAI，接着发一段录音给内置服务，先转成 WAV 再交给 OpenAI，4 秒回来；换回 Gemini；删掉 OpenAI 的 key 后粘贴一把错的，说 key 无效、还是 Gemini；粘贴对的，存好并换过去。重启后台后用的仍是 OpenAI。
  - 安装脚本的预检查真跑过一次（本机打的包、临时目录、只装不启动）：两家都打了勾。两家连不上时的样子只在自动测试里（假的 curl）看过。
- 只有自动测试、没在真机上试的：启动时断网、从 0.1 版搬数据、重新检查权限时不再反复弹系统授权框。

## 许可

[MIT](LICENSE)。`.claude/skills/reverse-engineer-anything/` 来自 REA，按它自己的 MIT 许可。

发布包里的依赖都是 MIT、Apache、ISC、BSD 这类。打包时会扫一遍依赖的许可证，有 GPL 一类的就拒绝打包（`scripts/build/stage-app.mjs`）；音频解码库顺带装上的那几个 GPL、LGPL 解码器程序用不到，打包时删掉。
