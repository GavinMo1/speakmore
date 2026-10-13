<h1 align="center">SpeakMore</h1>

<p align="center">
  按一下热键说话，再按一下，整理好的文字就贴进你正在用的输入框。<br>
  macOS 上的开源语音输入，用你自己的 Gemini API key。
</p>

口头禅、改口、重复会被整理掉，长一点的话会分段、分点。只做语音转写这一件事：不采集屏幕和输入框里的内容，没有账号，没有云同步。

名字和 Typeless 反着来：它是照着对 Typeless 的[逆向分析](targets/typeless/README.md)做的独立实现，和 Typeless 官方没有关系。

## 装和用

需要 macOS 12 以上，和一把 [Gemini API key](https://aistudio.google.com/apikey)。别的都不用装：不需要 Node、npm，也不需要 sudo。

```bash
curl -fsSL https://github.com/zephyr4123/speakmore/releases/latest/download/install.sh | bash
```

这一行做三件事：

1. **预检查**：系统版本、芯片、磁盘空间、下载地址和 Gemini 连不连得上。哪一项不行会说清楚原因和怎么办，不行就什么都不装。
2. **安装**：下载、核对校验值，把程序和它自带的运行环境放进 `~/.speakmore`，在 `~/.local/bin` 建一个 `speakmore` 命令。
3. **启动**：在终端里问你要 key（粘贴后回车，输入不会显示出来），系统弹出麦克风授权框时点“允许”，然后显示状态。还缺系统权限的话会顺手打开设置窗口，每一项旁边有去系统设置的按钮。

看到下面这样就可以用了：点进任意输入框，按一下右 Option，说话，再按一下。

```text
SpeakMore 0.2.0 · 运行中

  可以用了：点进任意输入框，按一下右 Option 键开始说话，再按一下结束，文字会贴进去。

  key       已保存，验证通过
  权限      麦克风 ✓   输入监控 ✓   辅助功能 ✓
  热键      右 Option 键
  模型      gemini-3.5-flash（MINIMAL）
  今天      12 次 · 1,024 字 · 3 分 20 秒
  累计      132 次 · 12,480 字 · 48 分钟 · 每分钟 260 字
```

它在后台运行，关掉终端窗口也还在，菜单栏上有“听写”两个字。电脑重启后要再运行一次 `speakmore`。

**升级**：把安装那一行再运行一次。程序换成新的，设置、key、历史和录音不动。

**卸载**：`speakmore uninstall`。它停掉后台，把 `~/.speakmore`、那个命令链接、钥匙串里的那一条一起删掉。只想删程序、留下自己的东西，加 `--keep-data`。

## 命令

| 命令 | 做什么 |
| --- | --- |
| `speakmore` | 启动。已经在运行就只显示状态；没有 key 时问你要 |
| `speakmore stop` / `restart` | 停掉 / 重启。它卡住不答话时也停得掉 |
| `speakmore status [--json]` | 在不在运行、key、三项权限、今天和累计说了多少。能用时退出码是 0 |
| `speakmore history [-n 条数] [--json]` | 看说过的话，按天分组，新的在前。失败的那条会写原因，录音还留着 |
| `speakmore key` | 换一把 key。也可以从管道喂：`pbpaste \| speakmore key`。别把 key 写在命令后面，那样会进 shell 的历史记录 |
| `speakmore key --forget` | 删掉存着的 key |
| `speakmore config` | 看设置，以及东西都放在哪 |
| `speakmore config set <名字> <值>` | 改一项设置，正在运行的话自动重启，并告诉你新的值能不能用。`unset` 回到默认 |
| `speakmore settings` | 打开设置窗口（去系统设置授权时用） |
| `speakmore logs [-n 行数] [-f]` | 看日志 |
| `speakmore uninstall [--keep-data]` | 卸载。先说清楚要删什么，问一句再动手 |

## 三项系统权限

| 权限 | 用来做什么 | 没有时的表现 |
| --- | --- | --- |
| 麦克风 | 录音 | 按热键时屏幕下方提示没有麦克风权限 |
| 输入监控 | 听热键。只认你选的那一个键，别的按键不记录 | 热键没反应，`speakmore status` 里标出来 |
| 辅助功能 | 模拟 ⌘V 把文字贴进去 | 照样能用，文字放进剪贴板，自己按 ⌘V |

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
| `model` | `gemini-3.5-flash` | Gemini 的模型名。换模型时留意下一项 |
| `thinking` | `MINIMAL` | `MINIMAL` / `LOW` / `MEDIUM` / `HIGH`，越高越慢。有的模型不接受 `MINIMAL` |

设置存在 `~/.speakmore/settings.json` 里。只想临时换一次，可以用环境变量 `SPEAKMORE_HOTKEY`、`GEMINI_MODEL`、`GEMINI_THINKING_LEVEL`，它们优先于文件。`GEMINI_API_KEY` 也一样：设着的话这次用它，不读存着的那把。

环境变量要写在**启动它的那条命令**上才算数。SpeakMore 已经在运行时，先 `speakmore stop`，再带着环境变量运行 `speakmore`。状态面板上的热键和模型，写的是正在运行的那个实际在用的。

带着 `GEMINI_API_KEY` 运行时再执行 `speakmore key`，新的那把会存下来并立刻换上；但只要环境变量还在，下次启动用的仍是环境变量里的那把。

## 出了状况

| 看到的 | 怎么办 |
| --- | --- |
| 面板上 key 那一行写着“还没验证” | 启动时没连上 Gemini，存着的 key 先用着。连上网后再运行一次 `speakmore status` |
| “还差：Gemini 验证” | Gemini 拒绝了请求，多半是模型名或思考档位不对，key 未必有问题。`speakmore config` 看一眼，`speakmore config unset model` 回到默认 |
| “还差：按键监听” | 听热键的小程序停了。`speakmore restart`，还不行就看 `speakmore logs` |
| 命令说它“没有在 5 秒内回话” | 后台卡住了。`speakmore stop` 会强行结束它，再运行 `speakmore` |

## 都放在哪

**发出去的只有录音**，直接发给 Google 的 Gemini 接口，用的是你自己的 key。没有别的服务器，没有统计上报，也不读屏幕和输入框里的内容。

留在本机的全在 `~/.speakmore/` 这一个目录里，只有你自己进得去：

| 里面的东西 | 说明 |
| --- | --- |
| `settings.json` | 上面那几项设置 |
| `gemini-key.bin` | 加密后的 key。解密用的密钥在系统钥匙串的“SpeakMore Safe Storage”里，文件被拷走也解不开 |
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

然后照着文档里的协议和交互重新写了一个，只保留语音转写：服务端换成自己的（一次 Gemini 调用完成识别和整理），不采集屏幕和输入框内容，不需要账号。仓库里不含 Typeless 的代码和密钥。

## 现在的不足

和 Typeless 比：

- **专有名词和人名会听错。** Typeless 会把当前应用和屏幕上的文字一起上传当上下文，这里只有录音，也还没有个人词典。
- **列表用得比它少**，口吃偶尔删不干净（约每 60 条 1 条）。
- **话说到一半就按停，模型可能自己把后半句补上。** 实测过一次：录音在“大家记得”处被截断，成品里多出了没说过的“准时参加”；同一段话录完整时成品是对的。还没有针对它调提示词。
- 只有听写，没有翻译和“问任何事”。

还没做的：

- 登录时自动启动。现在重启电脑后要再运行一次 `speakmore`。
- 失败的听写重试。录音留着，但还不能一键重新整理。
- 图形界面的主窗口，会用 Tauri 另做。现在的入口是命令行，加一个菜单栏图标和设置窗口。
- Windows 和 Linux。

## 开发

从源码跑需要 Node 22.13 以上（用 23 的话要 23.4 以上）和 Xcode 命令行工具（`xcode-select --install`）：

```bash
git clone https://github.com/zephyr4123/speakmore.git
cd speakmore
npm install
npm start                     # 就是 speakmore；子命令写在 -- 后面，比如 npm start -- status
npm run check                 # 代码检查 + 全部测试（271 条，不联网、不开窗口）
npm run release               # 打发布包：dist/release/ 下两种芯片各一个，外加 install.sh
```

从源码跑的和装好的用的是同一个 `~/.speakmore`，想分开就设 `SPEAKMORE_HOME`。

要真调 Gemini 的命令需要环境里有 `GEMINI_API_KEY`。`scripts/with-gemini-key.sh` 可以按你自己机器上的配置把它只喂给一条命令，见 `.machine.env.example`：

```bash
scripts/with-gemini-key.sh node scripts/e2e.mjs 一段录音.wav   # 端到端：真的 Electron、录音编码、Gemini；麦克风和贴字是假的
scripts/with-gemini-key.sh node scripts/eval-prompt.mjs --label v1   # 拿自己 Typeless 的历史录音评估提示词
scripts/with-gemini-key.sh node src/server/main.mjs           # 单独启动听写服务，配合 SPEAKMORE_SERVER_URL 调试
node scripts/replay.mjs 块1.ogg 块2.ogg                           # 把现成的录音发给单独启动的服务
```

不发布也可以试安装脚本：`SPEAKMORE_INSTALL_BASE=$PWD/dist/release SPEAKMORE_HOME=/tmp/sm bash install.sh`，装进一个临时目录。

| 目录 | 内容 |
| --- | --- |
| `install.sh` | 安装脚本：预检查、下载、校验、装进 `~/.speakmore`、启动 |
| `bin/`、`src/cli/` | `speakmore` 命令 |
| `src/app/` | 后台应用的主进程（Electron）：悬浮条、菜单栏、设置和历史窗口 |
| `src/renderer/`、`src/preload/` | 各个窗口的页面：状态机、录音、听写协议的客户端 |
| `src/server/` | 听写服务：收分块音频，交给 Gemini 整理。平时跑在后台应用的进程里 |
| `native/` | 听热键和贴字的小程序（Swift） |
| `src/*.mjs` | 命令和后台应用共用的：东西放在哪、设置、历史库、控制通道、日志、旧数据的迁移 |
| `test/` | 自动测试，目录和 `src/` 对应 |
| `scripts/` | 开发用的脚本：编译小程序、打发布包、端到端、评估提示词；按每台机器自己的配置加载 key、核对 GitHub 账号、检查本机信息有没有漏进仓库（配置样板是 `.machine.env.example`） |
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

- 自动测试 271 条，在 Node 22.13、24.21、26.0 上都跑过。其中 15 条是拿假的发布包真的跑安装脚本：全新安装、升级、各项预检查不过、校验不过、停不掉、路径里有空格和引号。
- 用真的发布包走过一遍，装在临时目录里，`PATH` 里没有 Node：
  - 安装脚本从管道读入，装完直接启动并问 key，输入不显示。
  - 启动、状态、设置、重启、停止；合成的语音经过录音编码、Gemini、存历史，成品正确。
  - 再装一次（升级），历史还在。
  - `speakmore uninstall` 之后目录、命令链接、后台进程、钥匙串里的那一条都没了。
- Intel 的那一份只在 Apple 芯片的机器上借 Rosetta 跑过（命令、后台、小程序都起得来），**没有在真的 Intel 机器上试过**。
- 上一版在真机上走过的那些路（多行 key 被拒、后台卡住时强行结束、同时启动、模型名写错）这一版重跑了自动测试，没有逐条重走。
- **还没有人按着真键盘、对着真麦克风用这一版试过。** 也还没有从 GitHub 上真的下载安装过：安装脚本是拿本机打好的包试的。
- 只有自动测试、没在真机上试的：启动时断网、从 0.1 版搬数据、重新检查权限时不再反复弹系统授权框。

## 许可

[MIT](LICENSE)。`.claude/skills/reverse-engineer-anything/` 来自 REA，按它自己的 MIT 许可。
